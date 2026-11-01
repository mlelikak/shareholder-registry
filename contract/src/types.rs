//! Data stored by the contract. No names, contact details, bank numbers,
//! reasons or amounts live here: only account IDs, timestamps, statuses,
//! share counts and hashes.

use near_sdk::{AccountId, near};
use std::collections::BTreeMap;

/// Time limits in milliseconds, fixed at deploy time.
/// The demo uses minutes; production uses days and months.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    pub cooling_off_ms: u64,
    pub extended_cooling_off_ms: u64,
    pub recent_contact_change_ms: u64,
    pub stale_after_ms: u64,
    pub verification_valid_for_ms: u64,
}

/// Accounts allowed to perform each restricted role, fixed at deploy time.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Roles {
    pub verifier: AccountId,
    pub kyc_provider: AccountId,
    pub agent: AccountId,
    pub estate_reviewer: AccountId,
    pub payout_service: AccountId,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum PayoutMethod {
    Near,
    Intents,
    Bank,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub struct IntentsRoute {
    pub chain: String,
    pub asset_id: String,
    pub address: String,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum ContactStatus {
    Ok,
    Bounced,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Screening {
    Clear,
    Review,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum HolderState {
    Active,
    Paused,
    Frozen,
    Transferred,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PendingChange {
    pub method: PayoutMethod,
    pub new_account: Option<AccountId>,
    pub new_fingerprint: Option<String>,
    pub new_route: Option<IntentsRoute>,
    pub requested_at: u64,
    pub effective_at: u64,
    pub extended: bool,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum HelperAction {
    Add,
    Remove,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PendingHelperChange {
    pub helper_id: AccountId,
    pub action: HelperAction,
    pub effective_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Transfer {
    pub new_account: AccountId,
    pub approved_by: AccountId,
    pub approved_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Holder {
    pub payout_method: PayoutMethod,
    pub payout_account: AccountId,
    pub intents_route: Option<IntentsRoute>,
    pub bank_fingerprint: Option<String>,
    pub pending_change: Option<PendingChange>,
    pub helpers: Vec<AccountId>,
    pub pending_helper_changes: Vec<PendingHelperChange>,
    pub last_confirmed_at: Option<u64>,
    pub contact_status: ContactStatus,
    pub contact_changed_at: Option<u64>,
    pub change_count: u32,
    pub kyc_valid_until: Option<u64>,
    pub screening: Screening,
    pub state: HolderState,
    pub transfer: Option<Transfer>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct BankVerification {
    pub fingerprint: String,
    pub verified_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Company {
    pub name: String,
    pub admin: AccountId,
    pub payout_token: AccountId,
    pub total_shares: u64,
    pub holdings: BTreeMap<AccountId, u64>,
    /// Set while a payout event is open; share counts can't be edited then.
    pub open_event: Option<String>,
}

#[near(serializers = [json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Status {
    Green,
    Amber,
    Red,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RegisterLine {
    pub holder_id: AccountId,
    pub shares: u64,
    pub status: Option<Status>,
    pub state: Option<HolderState>,
}

// ---------- Payout events ----------

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, PartialEq, Debug)]
pub enum Confirmation {
    Unconfirmed,
    Confirmed,
    /// The number the investor gave.
    Disputed { shares: u64 },
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum PayoutState {
    Preparing,
    Funded,
    Executed,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Outcome {
    InFlight,
    AwaitingRoute,
    Released,
    Settling,
    Paid,
    Queued,
    Held,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Line {
    pub shares: u64,
    #[serde(with = "u128_string")]
    pub amount: u128,
    pub outcome: Outcome,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PayoutEvent {
    pub company_id: String,
    #[serde(with = "u128_string")]
    pub total: u128,
    pub record_date: u64,
    pub snapshot: BTreeMap<AccountId, u64>,
    pub confirmations: BTreeMap<AccountId, Confirmation>,
    #[serde(with = "u128_string")]
    pub funded: u128,
    pub state: PayoutState,
    pub manifest_root: Option<String>,
    #[serde(with = "u128_string")]
    pub remainder: u128,
    pub lines: BTreeMap<AccountId, Line>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Correction {
    pub holder_id: AccountId,
    pub shares: u64,
}

#[near(serializers = [json])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum RouteResult {
    Success,
    Failed,
    Refunded,
    IncompleteDeposit,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PayoutTotals {
    #[serde(with = "u128_string")]
    pub paid: u128,
    #[serde(with = "u128_string")]
    pub queued: u128,
    #[serde(with = "u128_string")]
    pub held: u128,
    #[serde(with = "u128_string")]
    pub in_flight: u128,
    #[serde(with = "u128_string")]
    pub remainder: u128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PayoutView {
    pub event: PayoutEvent,
    pub totals: PayoutTotals,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ReadinessLine {
    pub holder_id: AccountId,
    pub shares: u64,
    pub confirmation: Confirmation,
    pub status: Status,
    pub ready: bool,
}

/// Sends large amounts as text, because JavaScript can't hold them as numbers.
mod u128_string {
    use near_sdk::serde::{Deserialize, Deserializer, Serializer, de::Error};

    pub fn serialize<S: Serializer>(value: &u128, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u128, D::Error> {
        String::deserialize(d)?.parse().map_err(D::Error::custom)
    }
}
