//! Payout events: snapshot, confirmations, corrections, checks and payment.
//! All amounts are calculated here with integer arithmetic. No AI touches them.

use crate::manifest::{self, ProofStep};
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::{Gas, NearToken, Promise, ext_contract};
use std::collections::BTreeMap;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(6);
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const OPEN_OUTCOMES: &[Outcome] = &[
    Outcome::InFlight,
    Outcome::AwaitingRoute,
    Outcome::Released,
    Outcome::Settling,
];

#[allow(dead_code)]
#[ext_contract(ext_ft)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
impl Contract {
    // ---------- Company admin ----------

    pub fn open_payout(&mut self, event_id: String, company_id: String, total: U128) {
        let mut company = self.admin_company(&company_id);
        require!(company.open_event.is_none(), "a payout is already open");
        require!(!self.payouts.contains_key(&event_id), "event already exists");
        require!(total.0 > 0, "total must be above zero");
        require!(
            company.holdings.values().sum::<u64>() == company.total_shares,
            "holdings don't add up to total shares"
        );

        let snapshot = company.holdings.clone();
        let confirmations = snapshot
            .keys()
            .map(|holder| (holder.clone(), Confirmation::Unconfirmed))
            .collect();
        self.payouts.insert(
            event_id.clone(),
            PayoutEvent {
                company_id: company_id.clone(),
                total: total.0,
                record_date: env::block_timestamp_ms(),
                snapshot,
                confirmations,
                funded: 0,
                state: PayoutState::Preparing,
                manifest_root: None,
                remainder: 0,
                lines: BTreeMap::new(),
            },
        );
        company.open_event = Some(event_id.clone());
        self.companies.insert(company_id, company);
        emit("payout_opened", json!({ "event_id": event_id }));
    }

    /// Only a holder's own dispute lets their number change, so a company can't
    /// shift shares away from someone who stays silent.
    pub fn resolve_dispute(&mut self, event_id: String, corrections: Vec<Correction>) {
        let mut event = self.event(&event_id);
        let mut company = self.admin_company(&event.company_id);
        require!(
            event.state != PayoutState::Executed,
            "the payout has already run"
        );
        require!(!corrections.is_empty(), "no corrections given");

        for correction in &corrections {
            require!(
                matches!(
                    event.confirmations.get(&correction.holder_id),
                    Some(Confirmation::Disputed { .. })
                ),
                "a correction needs an open dispute from that holder"
            );
            if correction.shares == 0 {
                event.snapshot.remove(&correction.holder_id);
                event.confirmations.remove(&correction.holder_id);
                company.holdings.remove(&correction.holder_id);
            } else {
                event
                    .snapshot
                    .insert(correction.holder_id.clone(), correction.shares);
                event
                    .confirmations
                    .insert(correction.holder_id.clone(), Confirmation::Unconfirmed);
                company
                    .holdings
                    .insert(correction.holder_id.clone(), correction.shares);
            }
        }
        require!(
            event.snapshot.values().sum::<u64>() == company.total_shares,
            "corrections must keep the total unchanged"
        );

        self.companies.insert(event.company_id.clone(), company);
        self.payouts.insert(event_id, event);
    }

    /// Runs every check, publishes the manifest root, then pays. If a check
    /// fails the whole call fails and nothing moves.
    pub fn execute_payout(&mut self, event_id: String) {
        let mut event = self.event(&event_id);
        let mut company = self.admin_company(&event.company_id);
        require!(event.state == PayoutState::Funded, "the payout is not funded");
        require!(
            event.snapshot.values().sum::<u64>() == company.total_shares,
            "check failed: snapshot doesn't add up to total shares"
        );
        require!(
            event.funded == event.total,
            "check failed: funded amount doesn't equal the total"
        );
        require!(
            !event
                .confirmations
                .values()
                .any(|c| matches!(c, Confirmation::Disputed { .. })),
            "check failed: a dispute is open"
        );

        let now = env::block_timestamp_ms();
        let total_shares = company.total_shares as u128;
        let mut leaves = Vec::new();
        let mut pay_now = Vec::new();
        let mut held_now = Vec::new();
        for (holder_id, shares) in &event.snapshot {
            let amount = event
                .total
                .checked_mul(*shares as u128)
                .unwrap_or_else(|| env::panic_str("amount overflow"))
                / total_shares;
            leaves.push(manifest::leaf(&event_id, holder_id, *shares, amount));

            let holder = self.get_holder(holder_id.clone());
            let confirmed = event.confirmations.get(holder_id) == Some(&Confirmation::Confirmed);
            let ready = confirmed
                && holder.as_ref().is_some_and(|h| {
                    h.state == HolderState::Active
                        && status_of(h, &self.config, now) != Status::Red
                });
            let outcome = match (ready, holder.as_ref().map(|h| h.payout_method)) {
                (false, _) | (true, None) => {
                    held_now.push((holder_id.clone(), amount));
                    Outcome::Held
                }
                (true, Some(_)) if amount == 0 => Outcome::Paid,
                (true, Some(PayoutMethod::Near)) => {
                    let to = holder.as_ref().unwrap().payout_account.clone();
                    pay_now.push((holder_id.clone(), to, amount));
                    Outcome::InFlight
                }
                (true, Some(PayoutMethod::Intents)) => Outcome::AwaitingRoute,
                (true, Some(PayoutMethod::Bank)) => Outcome::Queued,
            };
            event.lines.insert(
                holder_id.clone(),
                Line {
                    shares: *shares,
                    amount,
                    outcome,
                },
            );
        }

        event.remainder = event.total - event.lines.values().map(|l| l.amount).sum::<u128>();
        let totals = totals_of(&event);
        require!(
            totals.in_flight + totals.queued + totals.held + totals.paid + totals.remainder
                == event.total,
            "check failed: amounts don't add up to the total"
        );

        let root = manifest::hex(&manifest::root(&leaves));
        event.manifest_root = Some(root.clone());
        event.state = PayoutState::Executed;
        company.open_event = None;
        *self
            .remainders
            .entry(event.company_id.clone())
            .or_insert(0) += event.remainder;

        emit(
            "payout_manifest",
            json!({
                "event_id": event_id,
                "manifest_root": root,
                "lines": event.lines.len(),
            }),
        );

        let token = company.payout_token.clone();
        self.companies.insert(event.company_id.clone(), company);
        let company_id = event.company_id.clone();
        let done = !has_open_lines(&event);
        let counts = counts_of(&event);
        self.payouts.insert(event_id.clone(), event);

        for (holder_id, amount) in held_now {
            self.add_held(&company_id, &holder_id, amount, &event_id);
        }
        for (holder_id, to, amount) in pay_now {
            self.transfer(&token, to, amount)
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_CALLBACK)
                        .on_payout_transfer(event_id.clone(), holder_id, U128(amount)),
                )
                .detach();
        }
        if done {
            emit("payout_settled", counts);
        }
    }

    pub fn collect_remainder(&mut self, company_id: String) {
        let company = self.admin_company(&company_id);
        let amount = self.remainders.remove(&company_id).unwrap_or(0);
        require!(amount > 0, "no remainder to collect");
        self.transfer(&company.payout_token, company.admin, amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_remainder_transfer(company_id, U128(amount)),
            )
            .detach();
    }

    // ---------- Token funding ----------

    /// Called by the token. Returning the amount sends it back to the sender.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let token = env::predecessor_account_id();
        let accepted = self.payouts.get(&msg).cloned().and_then(|mut event| {
            let company = self.companies.get(&event.company_id)?;
            let exact = company.payout_token == token
                && company.admin == sender_id
                && event.state == PayoutState::Preparing
                && amount.0 == event.total;
            exact.then(|| {
                event.funded = amount.0;
                event.state = PayoutState::Funded;
                event
            })
        });
        match accepted {
            Some(event) => {
                self.payouts.insert(msg, event);
                U128(0)
            }
            None => amount,
        }
    }

    // ---------- Investors ----------

    pub fn confirm_holding(&mut self, event_id: String, shares: u64) {
        let holder_id = env::predecessor_account_id();
        let mut event = self.event(&event_id);
        let on_record = *event
            .snapshot
            .get(&holder_id)
            .unwrap_or_else(|| env::panic_str("holder is not in this payout"));
        if shares == on_record {
            event
                .confirmations
                .insert(holder_id.clone(), Confirmation::Confirmed);
            emit(
                "holding_confirmed",
                json!({ "event_id": event_id, "holder_id": holder_id }),
            );
        } else {
            event
                .confirmations
                .insert(holder_id.clone(), Confirmation::Disputed { shares });
            emit(
                "holding_disputed",
                json!({ "event_id": event_id, "holder_id": holder_id }),
            );
        }
        self.payouts.insert(event_id, event);
    }

    /// Pays out held money once the holder passes the same gate as a payout.
    /// An estate's successor passes the original holder as `holder_id`.
    pub fn claim(&mut self, company_id: String, holder_id: Option<AccountId>) {
        let caller = env::predecessor_account_id();
        let holder_id = holder_id.unwrap_or_else(|| caller.clone());
        let holder = self.load(&holder_id);
        let key = (company_id.clone(), holder_id.clone());
        let events = self.held_events.get(&key).cloned().unwrap_or_default();

        let to = if holder.state == HolderState::Transferred {
            let transfer = holder.transfer.clone().unwrap();
            require!(
                caller == transfer.new_account,
                "only the approved successor can claim"
            );
            caller
        } else {
            require!(caller == holder_id, "only the holder can claim");
            require!(
                holder.state == HolderState::Active,
                "holder is not active"
            );
            require!(
                status_of(&holder, &self.config, env::block_timestamp_ms()) != Status::Red,
                "details or KYC need attention first"
            );
            for event_id in &events {
                let event = self.event(event_id);
                require!(
                    event.confirmations.get(&holder_id) == Some(&Confirmation::Confirmed),
                    "share count must be confirmed first"
                );
            }
            holder.payout_account.clone()
        };

        let amount = self.held.remove(&key).unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        self.held_events.remove(&key);

        if holder.payout_method == PayoutMethod::Bank
            && holder.state != HolderState::Transferred
        {
            self.set_outcomes(&events, &holder_id, Outcome::Queued);
            let queued = self.queued_claims.entry(key).or_insert((0, Vec::new()));
            queued.0 += amount;
            queued.1.extend(events);
            return;
        }

        let token = self.company(&company_id).payout_token;
        self.transfer(&token, to, amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_claim_transfer(company_id, holder_id, U128(amount), events),
            )
            .detach();
    }

    // ---------- Payout service ----------

    /// Reveals the holder's active route for delivery. The money stays in the
    /// contract until the delivery is reported as successful.
    pub fn release_for_route(&mut self, event_id: String, holder_id: AccountId) -> IntentsRoute {
        self.require_payout_service();
        let mut event = self.event(&event_id);
        let line = event
            .lines
            .get_mut(&holder_id)
            .unwrap_or_else(|| env::panic_str("no line for this holder"));
        require!(
            line.outcome == Outcome::AwaitingRoute,
            "this line is not waiting for a route"
        );
        let route = self
            .get_holder(holder_id.clone())
            .and_then(|h| h.intents_route)
            .unwrap_or_else(|| env::panic_str("no route registered"));
        line.outcome = Outcome::Released;
        self.payouts.insert(event_id, event);
        route
    }

    /// Success repays the service, which already delivered on the other chain.
    /// Anything else becomes held money, never paid.
    pub fn report_route_result(
        &mut self,
        event_id: String,
        holder_id: AccountId,
        result: RouteResult,
    ) {
        self.require_payout_service();
        let mut event = self.event(&event_id);
        let line = event
            .lines
            .get_mut(&holder_id)
            .unwrap_or_else(|| env::panic_str("no line for this holder"));
        // Only a released Intents line qualifies, and only once, so the service
        // can never collect an ordinary payment or be repaid twice.
        require!(
            line.outcome == Outcome::Released,
            "this line was not released for a route"
        );
        let amount = line.amount;
        match result {
            RouteResult::Success => {
                line.outcome = Outcome::Settling;
                let token = self.company(&event.company_id).payout_token;
                self.payouts.insert(event_id.clone(), event);
                self.transfer(&token, env::predecessor_account_id(), amount)
                    .then(
                        Self::ext(env::current_account_id())
                            .with_static_gas(GAS_CALLBACK)
                            .on_payout_transfer(event_id, holder_id, U128(amount)),
                    )
                    .detach();
            }
            _ => self.finish_line(&event_id, &holder_id, amount, false),
        }
    }

    /// The bank partner (the payout service's key) reports that it sent a bank
    /// payout that was queued at execution. The contract then hands the amount
    /// to the service, which already paid the bank transfer, and the line is
    /// paid. Only a queued line qualifies, and only once; if the hand-over
    /// fails, the money is held for the holder, never lost.
    pub fn report_bank_sent(&mut self, event_id: String, holder_id: AccountId) {
        self.require_payout_service();
        let mut event = self.event(&event_id);
        let line = event
            .lines
            .get_mut(&holder_id)
            .unwrap_or_else(|| env::panic_str("no line for this holder"));
        require!(line.outcome == Outcome::Queued, "this line is not queued for a bank");
        let key = (event.company_id.clone(), holder_id.clone());
        require!(
            !self.queued_claims.contains_key(&key),
            "this holder's bank payment is a queued claim"
        );
        line.outcome = Outcome::Settling;
        let amount = line.amount;
        let token = self.company(&event.company_id).payout_token;
        self.payouts.insert(event_id.clone(), event);
        self.transfer(&token, env::predecessor_account_id(), amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_payout_transfer(event_id, holder_id, U128(amount)),
            )
            .detach();
    }

    /// The same for held money a bank holder claimed later.
    pub fn report_bank_claim_sent(&mut self, company_id: String, holder_id: AccountId) {
        self.require_payout_service();
        let key = (company_id.clone(), holder_id.clone());
        let (amount, events) = self
            .queued_claims
            .remove(&key)
            .unwrap_or_else(|| env::panic_str("no bank claim is queued for this holder"));
        let token = self.company(&company_id).payout_token;
        self.transfer(&token, env::predecessor_account_id(), amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_claim_transfer(company_id, holder_id, U128(amount), events),
            )
            .detach();
    }

    // ---------- Callbacks ----------

    #[private]
    pub fn on_payout_transfer(&mut self, event_id: String, holder_id: AccountId, amount: U128) {
        let success = near_sdk::is_promise_success();
        self.finish_line(&event_id, &holder_id, amount.0, success);
    }

    #[private]
    pub fn on_claim_transfer(
        &mut self,
        company_id: String,
        holder_id: AccountId,
        amount: U128,
        events: Vec<String>,
    ) {
        if near_sdk::is_promise_success() {
            self.set_outcomes(&events, &holder_id, Outcome::Paid);
            emit("payout_paid", json!({ "holder_id": holder_id }));
        } else {
            let key = (company_id, holder_id.clone());
            *self.held.entry(key.clone()).or_insert(0) += amount.0;
            self.held_events.entry(key).or_default().extend(events);
            emit("payout_held", json!({ "holder_id": holder_id }));
        }
    }

    #[private]
    pub fn on_remainder_transfer(&mut self, company_id: String, amount: U128) {
        if !near_sdk::is_promise_success() {
            *self.remainders.entry(company_id).or_insert(0) += amount.0;
        }
    }

    // ---------- Read-only ----------

    pub fn get_payout(&self, event_id: String) -> Option<PayoutView> {
        self.payouts.get(&event_id).map(|event| PayoutView {
            totals: totals_of(event),
            event: event.clone(),
        })
    }

    /// One line per holder for the readiness screen. A dispute shows as red.
    pub fn get_readiness(&self, event_id: String) -> Vec<ReadinessLine> {
        let event = self.event(&event_id);
        let now = env::block_timestamp_ms();
        event
            .snapshot
            .iter()
            .map(|(holder_id, shares)| {
                let confirmation = event
                    .confirmations
                    .get(holder_id)
                    .cloned()
                    .unwrap_or(Confirmation::Unconfirmed);
                let holder = self.get_holder(holder_id.clone());
                let mut status = holder
                    .as_ref()
                    .map_or(Status::Red, |h| status_of(h, &self.config, now));
                if matches!(confirmation, Confirmation::Disputed { .. }) {
                    status = Status::Red;
                }
                let ready = status != Status::Red
                    && confirmation == Confirmation::Confirmed
                    && holder.as_ref().is_some_and(|h| h.state == HolderState::Active);
                ReadinessLine {
                    holder_id: holder_id.clone(),
                    shares: *shares,
                    confirmation,
                    status,
                    ready,
                }
            })
            .collect()
    }

    pub fn get_held_funds(&self, company_id: String, holder_id: AccountId) -> U128 {
        U128(self.held.get(&(company_id, holder_id)).copied().unwrap_or(0))
    }

    pub fn get_remainder(&self, company_id: String) -> U128 {
        U128(self.remainders.get(&company_id).copied().unwrap_or(0))
    }

    /// The proof an investor needs to check their own line.
    pub fn get_manifest_proof(&self, event_id: String, holder_id: AccountId) -> Vec<ProofStep> {
        let event = self.event(&event_id);
        let leaves = leaves_of(&event_id, &event);
        let index = event
            .lines
            .keys()
            .position(|h| *h == holder_id)
            .unwrap_or_else(|| env::panic_str("no line for this holder"));
        manifest::proof(&leaves, index)
    }

    pub fn verify_manifest_line(
        &self,
        event_id: String,
        holder_id: AccountId,
        shares: u64,
        amount: U128,
        proof: Vec<ProofStep>,
    ) -> bool {
        let event = self.event(&event_id);
        let leaf = manifest::leaf(&event_id, &holder_id, shares, amount.0);
        event
            .manifest_root
            .is_some_and(|root| manifest::verify(leaf, &proof, &root))
    }
}

fn leaves_of(event_id: &str, event: &PayoutEvent) -> Vec<[u8; 32]> {
    event
        .lines
        .iter()
        .map(|(holder, line)| manifest::leaf(event_id, holder, line.shares, line.amount))
        .collect()
}

fn totals_of(event: &PayoutEvent) -> PayoutTotals {
    let sum = |wanted: &[Outcome]| -> u128 {
        event
            .lines
            .values()
            .filter(|l| wanted.contains(&l.outcome))
            .map(|l| l.amount)
            .sum()
    };
    PayoutTotals {
        paid: sum(&[Outcome::Paid]),
        queued: sum(&[Outcome::Queued]),
        held: sum(&[Outcome::Held]),
        in_flight: sum(OPEN_OUTCOMES),
        remainder: event.remainder,
    }
}

fn has_open_lines(event: &PayoutEvent) -> bool {
    event
        .lines
        .values()
        .any(|l| OPEN_OUTCOMES.contains(&l.outcome))
}

fn counts_of(event: &PayoutEvent) -> Value {
    let count = |o: Outcome| event.lines.values().filter(|l| l.outcome == o).count();
    json!({
        "paid": count(Outcome::Paid),
        "queued": count(Outcome::Queued),
        "held": count(Outcome::Held),
    })
}

impl Contract {
    fn event(&self, event_id: &str) -> PayoutEvent {
        self.payouts
            .get(event_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown payout event"))
    }

    fn company(&self, company_id: &str) -> Company {
        self.companies
            .get(company_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown company"))
    }

    fn transfer(&self, token: &AccountId, to: AccountId, amount: u128) -> Promise {
        ext_ft::ext(token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to, U128(amount), None)
    }

    fn add_held(&mut self, company_id: &str, holder_id: &AccountId, amount: u128, event_id: &str) {
        let key = (company_id.to_string(), holder_id.clone());
        *self.held.entry(key.clone()).or_insert(0) += amount;
        let events = self.held_events.entry(key).or_default();
        if !events.iter().any(|e| e == event_id) {
            events.push(event_id.to_string());
        }
        emit("payout_held", json!({ "holder_id": holder_id }));
    }

    fn set_outcomes(&mut self, events: &[String], holder_id: &AccountId, outcome: Outcome) {
        for event_id in events {
            let mut event = self.event(event_id);
            if let Some(line) = event.lines.get_mut(holder_id) {
                line.outcome = outcome;
            }
            self.payouts.insert(event_id.clone(), event);
        }
    }

    fn finish_line(&mut self, event_id: &str, holder_id: &AccountId, amount: u128, success: bool) {
        let mut event = self.event(event_id);
        let company_id = event.company_id.clone();
        if let Some(line) = event.lines.get_mut(holder_id) {
            line.outcome = if success { Outcome::Paid } else { Outcome::Held };
        }
        let done = !has_open_lines(&event);
        let counts = counts_of(&event);
        self.payouts.insert(event_id.to_string(), event);

        if success {
            emit("payout_paid", json!({ "holder_id": holder_id }));
        } else {
            self.add_held(&company_id, holder_id, amount, event_id);
        }
        if done {
            emit("payout_settled", counts);
        }
    }

    fn require_payout_service(&self) {
        require!(
            env::predecessor_account_id() == self.roles.payout_service,
            "only the payout service can do this"
        );
    }
}
