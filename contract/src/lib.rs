//! Shareholder registry: payout details controlled only by the investor.
//! The rules are specified in DESIGN.md.

use near_sdk::serde_json::{Value, json};
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, near, require};

mod types;
pub use types::*;

#[cfg(test)]
mod tests;

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Holders,
    BankVerifications,
    Companies,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    config: Config,
    roles: Roles,
    holders: LookupMap<AccountId, Holder>,
    bank_verifications: LookupMap<AccountId, BankVerification>,
    companies: LookupMap<String, Company>,
}

/// Writes a NEP-297 event. Callers pass only neutral data, never a reason.
fn emit(event: &str, data: Value) {
    let line = json!({
        "standard": "shareholder_registry",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{line}"));
}

fn require_hash(value: &str) {
    require!(
        value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()),
        "expected a 64-character hex hash"
    );
}

/// Applies anything whose waiting period has ended and reports what changed.
/// Nothing takes effect while a holder is paused, frozen or transferred.
fn settle(holder: &mut Holder, now: u64) -> Vec<(&'static str, Value)> {
    let mut changes = Vec::new();
    if holder.state != HolderState::Active {
        return changes;
    }

    if holder
        .pending_change
        .as_ref()
        .is_some_and(|p| now >= p.effective_at)
    {
        let pending = holder.pending_change.take().unwrap();
        holder.payout_method = pending.method;
        if let Some(account) = pending.new_account {
            holder.payout_account = account;
        }
        if let Some(fingerprint) = pending.new_fingerprint {
            holder.bank_fingerprint = Some(fingerprint);
        }
        if let Some(route) = pending.new_route {
            holder.intents_route = Some(route);
        }
        holder.change_count += 1;
        changes.push(("payout_change_effective", json!({})));
    }

    let (due, waiting): (Vec<_>, Vec<_>) = std::mem::take(&mut holder.pending_helper_changes)
        .into_iter()
        .partition(|c| now >= c.effective_at);
    holder.pending_helper_changes = waiting;
    for change in due {
        match change.action {
            HelperAction::Add => {
                if !holder.helpers.contains(&change.helper_id) {
                    holder.helpers.push(change.helper_id.clone());
                }
                changes.push(("helper_added", json!({ "helper_id": change.helper_id })));
            }
            HelperAction::Remove => {
                holder.helpers.retain(|h| h != &change.helper_id);
                changes.push(("helper_removed", json!({ "helper_id": change.helper_id })));
            }
        }
    }
    changes
}

fn status_of(holder: &Holder, config: &Config, now: u64) -> Status {
    let age = holder
        .last_confirmed_at
        .map(|confirmed| now.saturating_sub(confirmed));
    let kyc_left = holder
        .kyc_valid_until
        .map(|until| until.saturating_sub(now));

    let red = holder.contact_status == ContactStatus::Bounced
        || holder.screening == Screening::Review
        || age.is_none_or(|a| a > config.stale_after_ms.saturating_mul(2))
        || kyc_left.is_none_or(|left| left == 0);
    if red {
        return Status::Red;
    }

    let amber = holder.pending_change.is_some()
        || age.is_some_and(|a| a > config.stale_after_ms)
        || kyc_left.is_some_and(|left| left <= config.stale_after_ms);
    if amber { Status::Amber } else { Status::Green }
}

#[near]
impl Contract {
    #[init]
    pub fn new(config: Config, roles: Roles) -> Self {
        Self {
            config,
            roles,
            holders: LookupMap::new(StorageKey::Holders),
            bank_verifications: LookupMap::new(StorageKey::BankVerifications),
            companies: LookupMap::new(StorageKey::Companies),
        }
    }

    // ---------- Investors ----------

    pub fn register_holder(&mut self) {
        let holder_id = env::predecessor_account_id();
        require!(!self.holders.contains_key(&holder_id), "already registered");
        let holder = Holder {
            payout_method: PayoutMethod::Near,
            payout_account: holder_id.clone(),
            intents_route: None,
            bank_fingerprint: None,
            pending_change: None,
            helpers: Vec::new(),
            pending_helper_changes: Vec::new(),
            last_confirmed_at: None,
            contact_status: ContactStatus::Ok,
            contact_changed_at: None,
            change_count: 0,
            kyc_valid_until: None,
            screening: Screening::Clear,
            state: HolderState::Active,
            transfer: None,
        };
        self.holders.insert(holder_id, holder);
    }

    /// Resets the clock, clears a bounce and lifts an agent pause.
    /// It never lifts a freeze.
    pub fn confirm_details(&mut self) {
        let holder_id = env::predecessor_account_id();
        let mut holder = self.load(&holder_id);
        holder.last_confirmed_at = Some(env::block_timestamp_ms());
        holder.contact_status = ContactStatus::Ok;
        if holder.state == HolderState::Paused {
            holder.state = HolderState::Active;
        }
        self.holders.insert(holder_id, holder);
    }

    /// Records that a phone or email changed. The details stay off-chain.
    pub fn record_contact_change(&mut self) {
        let holder_id = env::predecessor_account_id();
        let mut holder = self.load(&holder_id);
        holder.contact_changed_at = Some(env::block_timestamp_ms());
        self.holders.insert(holder_id, holder);
    }

    pub fn request_payout_change(
        &mut self,
        holder_id: AccountId,
        method: PayoutMethod,
        new_account: Option<AccountId>,
        new_route: Option<IntentsRoute>,
    ) {
        require!(
            env::predecessor_account_id() == holder_id,
            "only the holder can request a payout change"
        );
        let mut holder = self.load(&holder_id);
        require!(
            holder.state == HolderState::Active,
            "holder is not active"
        );
        require!(
            holder.pending_change.is_none(),
            "a change is already pending"
        );

        let now = env::block_timestamp_ms();
        let mut new_fingerprint = None;
        match method {
            PayoutMethod::Near => {
                require!(new_account.is_some(), "new_account is required");
            }
            PayoutMethod::Intents => {
                let route = new_route.as_ref();
                require!(
                    route.is_some_and(|r| !r.chain.is_empty()
                        && !r.asset_id.is_empty()
                        && !r.address.is_empty()),
                    "a complete new_route is required"
                );
            }
            PayoutMethod::Bank => {
                let record = self
                    .bank_verifications
                    .get(&holder_id)
                    .unwrap_or_else(|| env::panic_str("no bank verification on record"));
                require!(
                    now.saturating_sub(record.verified_at) <= self.config.verification_valid_for_ms,
                    "bank verification is too old"
                );
                new_fingerprint = Some(record.fingerprint.clone());
            }
        }

        let contact_changed_recently = holder
            .contact_changed_at
            .is_some_and(|at| now.saturating_sub(at) < self.config.recent_contact_change_ms);
        let extended = holder.change_count == 0 || contact_changed_recently;
        let wait = if extended {
            self.config.extended_cooling_off_ms
        } else {
            self.config.cooling_off_ms
        };

        holder.pending_change = Some(PendingChange {
            method,
            new_account,
            new_fingerprint,
            new_route,
            requested_at: now,
            effective_at: now + wait,
            extended,
        });
        emit(
            "payout_change_requested",
            json!({ "holder_id": holder_id, "effective_at": now + wait }),
        );
        self.holders.insert(holder_id, holder);
    }

    /// Allowed for the investor and for their helpers.
    pub fn cancel_payout_change(&mut self, holder_id: AccountId) {
        let caller = env::predecessor_account_id();
        let mut holder = self.load(&holder_id);
        require!(
            caller == holder_id || holder.helpers.contains(&caller),
            "only the holder or a helper can cancel"
        );
        require!(holder.pending_change.is_some(), "no change is pending");
        holder.pending_change = None;
        emit("payout_change_cancelled", json!({ "holder_id": holder_id }));
        self.holders.insert(holder_id, holder);
    }

    pub fn add_helper(&mut self, helper_id: AccountId) {
        let holder_id = env::predecessor_account_id();
        require!(helper_id != holder_id, "a holder can't be their own helper");
        let mut holder = self.load(&holder_id);
        require!(
            !holder.helpers.contains(&helper_id),
            "already a helper"
        );
        self.queue_helper_change(&holder_id, &mut holder, helper_id, HelperAction::Add);
    }

    /// Waits and alerts like adding one, so a scammer can't coach an investor
    /// into removing their helper first. The helper keeps full powers until
    /// the wait ends.
    pub fn remove_helper(&mut self, helper_id: AccountId) {
        let holder_id = env::predecessor_account_id();
        let mut holder = self.load(&holder_id);
        require!(holder.helpers.contains(&helper_id), "not a helper");
        self.queue_helper_change(&holder_id, &mut holder, helper_id, HelperAction::Remove);
    }

    // ---------- Caretaker agent ----------

    pub fn flag_holder(&mut self, holder_id: AccountId, reason_hash: String) {
        self.require_agent();
        require_hash(&reason_hash);
        require!(self.holders.contains_key(&holder_id), "unknown holder");
        emit(
            "holder_flagged",
            json!({ "holder_id": holder_id, "reason_hash": reason_hash }),
        );
    }

    pub fn pause_holder(&mut self, holder_id: AccountId, reason_hash: String) {
        self.require_agent();
        require_hash(&reason_hash);
        let mut holder = self.load(&holder_id);
        require!(
            holder.state == HolderState::Active,
            "holder is not active"
        );
        holder.state = HolderState::Paused;
        emit(
            "holder_paused",
            json!({ "holder_id": holder_id, "reason_hash": reason_hash }),
        );
        self.holders.insert(holder_id, holder);
    }

    pub fn log_agent_action(&mut self, holder_id: AccountId, action: String, summary_hash: String) {
        self.require_agent();
        require_hash(&summary_hash);
        require!(action.len() <= 32, "action must be a short code");
        emit(
            "agent_action",
            json!({ "holder_id": holder_id, "action": action, "summary_hash": summary_hash }),
        );
    }

    // ---------- Freezing and transfers ----------

    /// Allowed for the holder's helpers, the agent, or the admin of a company
    /// the holder has shares in. No reason is recorded.
    pub fn freeze_holder(&mut self, holder_id: AccountId, company_id: Option<String>) {
        let caller = env::predecessor_account_id();
        let mut holder = self.load(&holder_id);
        let is_company_admin = company_id.is_some_and(|id| {
            self.companies
                .get(&id)
                .is_some_and(|c| c.admin == caller && c.holdings.contains_key(&holder_id))
        });
        require!(
            caller == self.roles.agent || holder.helpers.contains(&caller) || is_company_admin,
            "not allowed to freeze this holder"
        );
        require!(
            matches!(holder.state, HolderState::Active | HolderState::Paused),
            "holder can't be frozen"
        );
        holder.state = HolderState::Frozen;
        emit("holder_frozen", json!({ "holder_id": holder_id }));
        self.holders.insert(holder_id, holder);
    }

    /// Lifts a freeze made by mistake. Only the human reviewer can do this.
    pub fn unfreeze_holder(&mut self, holder_id: AccountId) {
        self.require_reviewer();
        let mut holder = self.load(&holder_id);
        require!(holder.state == HolderState::Frozen, "holder is not frozen");
        holder.state = HolderState::Active;
        emit("holder_unfrozen", json!({ "holder_id": holder_id }));
        self.holders.insert(holder_id, holder);
    }

    pub fn approve_transfer(&mut self, holder_id: AccountId, new_account: AccountId) {
        self.require_reviewer();
        let mut holder = self.load(&holder_id);
        require!(holder.state == HolderState::Frozen, "holder is not frozen");
        holder.pending_change = None;
        holder.state = HolderState::Transferred;
        holder.transfer = Some(Transfer {
            new_account,
            approved_by: env::predecessor_account_id(),
            approved_at: env::block_timestamp_ms(),
        });
        emit("holder_transferred", json!({ "holder_id": holder_id }));
        self.holders.insert(holder_id, holder);
    }

    // ---------- KYC provider and verifier ----------

    pub fn record_kyc(&mut self, holder_id: AccountId, valid_until: u64, screening: Screening) {
        require!(
            env::predecessor_account_id() == self.roles.kyc_provider,
            "only the KYC provider can record KYC"
        );
        let mut holder = self.load(&holder_id);
        holder.kyc_valid_until = Some(valid_until);
        holder.screening = screening;
        emit("kyc_recorded", json!({ "holder_id": holder_id }));
        self.holders.insert(holder_id, holder);
    }

    pub fn record_bank_verification(&mut self, holder_id: AccountId, fingerprint: String) {
        require!(
            env::predecessor_account_id() == self.roles.verifier,
            "only the verifier can record a bank verification"
        );
        require_hash(&fingerprint);
        require!(self.holders.contains_key(&holder_id), "unknown holder");
        self.bank_verifications.insert(
            holder_id,
            BankVerification {
                fingerprint,
                verified_at: env::block_timestamp_ms(),
            },
        );
    }

    // ---------- Company admins ----------

    pub fn create_company(
        &mut self,
        company_id: String,
        name: String,
        payout_token: AccountId,
        total_shares: u64,
    ) {
        require!(
            !self.companies.contains_key(&company_id),
            "company already exists"
        );
        require!(total_shares > 0, "total_shares must be above zero");
        self.companies.insert(
            company_id,
            Company {
                name,
                admin: env::predecessor_account_id(),
                payout_token,
                total_shares,
                holdings: Default::default(),
                open_event: None,
            },
        );
    }

    pub fn set_holding(&mut self, company_id: String, holder_id: AccountId, shares: u64) {
        let mut company = self.admin_company(&company_id);
        require!(
            company.open_event.is_none(),
            "share counts are locked during a payout"
        );
        if shares == 0 {
            company.holdings.remove(&holder_id);
        } else {
            company.holdings.insert(holder_id, shares);
        }
        self.companies.insert(company_id, company);
    }

    pub fn mark_contact_bounced(&mut self, company_id: String, holder_id: AccountId) {
        let company = self.admin_company(&company_id);
        require!(
            company.holdings.contains_key(&holder_id),
            "holder has no shares in this company"
        );
        let mut holder = self.load(&holder_id);
        holder.contact_status = ContactStatus::Bounced;
        self.holders.insert(holder_id, holder);
    }

    // ---------- Read-only ----------

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_roles(&self) -> Roles {
        self.roles.clone()
    }

    /// Shows the holder as they stand now, including finished waiting periods.
    pub fn get_holder(&self, holder_id: AccountId) -> Option<Holder> {
        self.holders.get(&holder_id).cloned().map(|mut holder| {
            settle(&mut holder, env::block_timestamp_ms());
            holder
        })
    }

    pub fn get_status(&self, holder_id: AccountId) -> Option<Status> {
        self.get_holder(holder_id)
            .map(|holder| status_of(&holder, &self.config, env::block_timestamp_ms()))
    }

    pub fn get_company(&self, company_id: String) -> Option<Company> {
        self.companies.get(&company_id).cloned()
    }

    pub fn get_register(&self, company_id: String) -> Vec<RegisterLine> {
        let company = self
            .companies
            .get(&company_id)
            .unwrap_or_else(|| env::panic_str("unknown company"));
        company
            .holdings
            .iter()
            .map(|(holder_id, shares)| {
                let holder = self.get_holder(holder_id.clone());
                RegisterLine {
                    holder_id: holder_id.clone(),
                    shares: *shares,
                    status: holder
                        .as_ref()
                        .map(|h| status_of(h, &self.config, env::block_timestamp_ms())),
                    state: holder.as_ref().map(|h| h.state),
                }
            })
            .collect()
    }
}

impl Contract {
    /// Reads a holder, applying and announcing any finished waiting periods.
    fn load(&mut self, holder_id: &AccountId) -> Holder {
        let mut holder = self
            .holders
            .get(holder_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown holder"));
        for (event, data) in settle(&mut holder, env::block_timestamp_ms()) {
            let mut data = data;
            data["holder_id"] = json!(holder_id);
            emit(event, data);
        }
        holder
    }

    fn queue_helper_change(
        &mut self,
        holder_id: &AccountId,
        holder: &mut Holder,
        helper_id: AccountId,
        action: HelperAction,
    ) {
        require!(
            !holder
                .pending_helper_changes
                .iter()
                .any(|c| c.helper_id == helper_id),
            "a change for this helper is already pending"
        );
        let effective_at = env::block_timestamp_ms() + self.config.cooling_off_ms;
        let event = match action {
            HelperAction::Add => "helper_add_requested",
            HelperAction::Remove => "helper_removal_requested",
        };
        emit(
            event,
            json!({
                "holder_id": holder_id,
                "helper_id": helper_id,
                "effective_at": effective_at,
            }),
        );
        holder.pending_helper_changes.push(PendingHelperChange {
            helper_id,
            action,
            effective_at,
        });
        self.holders.insert(holder_id.clone(), holder.clone());
    }

    fn admin_company(&self, company_id: &str) -> Company {
        let company = self
            .companies
            .get(company_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown company"));
        require!(
            env::predecessor_account_id() == company.admin,
            "only the company admin can do this"
        );
        company
    }

    fn require_agent(&self) {
        require!(
            env::predecessor_account_id() == self.roles.agent,
            "only the agent can do this"
        );
    }

    fn require_reviewer(&self) {
        require!(
            env::predecessor_account_id() == self.roles.estate_reviewer,
            "only the estate reviewer can do this"
        );
    }
}
