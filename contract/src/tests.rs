use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_logs};
use near_sdk::testing_env;

const MINUTE: u64 = 60_000;
const HASH: &str = "ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12";

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn config() -> Config {
    Config {
        cooling_off_ms: 2 * MINUTE,
        extended_cooling_off_ms: 5 * MINUTE,
        recent_contact_change_ms: 10 * MINUTE,
        stale_after_ms: 10 * MINUTE,
        verification_valid_for_ms: 10 * MINUTE,
    }
}

fn roles() -> Roles {
    Roles {
        verifier: account("verifier"),
        kyc_provider: account("kyc"),
        agent: account("agent"),
        estate_reviewer: account("reviewer"),
        payout_service: account("service"),
    }
}

/// Sets who is calling and the clock, in milliseconds.
fn act(caller: &str, now_ms: u64) {
    testing_env!(
        VMContextBuilder::new()
            .predecessor_account_id(account(caller))
            .block_timestamp(now_ms * 1_000_000)
            .build()
    );
}

fn contract() -> Contract {
    act("deployer", 0);
    Contract::new(config(), roles())
}

/// A registered, confirmed investor with valid KYC.
fn with_maria() -> Contract {
    let mut c = contract();
    act("maria", 0);
    c.register_holder();
    c.confirm_details();
    act("kyc", 0);
    c.record_kyc(account("maria"), 1_000 * MINUTE, Screening::Clear);
    c
}

fn request_near(c: &mut Contract, to: &str) {
    c.request_payout_change(
        account("maria"),
        PayoutMethod::Near,
        Some(account(to)),
        None,
    );
}

/// Maria completes one change, so later changes use the normal wait.
fn with_maria_changed_once() -> Contract {
    let mut c = with_maria();
    act("maria", 0);
    request_near(&mut c, "first");
    act("maria", 5 * MINUTE);
    c.confirm_details();
    c
}

fn holder(c: &Contract) -> Holder {
    c.get_holder(account("maria")).unwrap()
}

fn with_helper_anna() -> Contract {
    let mut c = with_maria();
    act("maria", 0);
    c.add_helper(account("anna"));
    act("maria", 2 * MINUTE);
    c.confirm_details();
    assert_eq!(holder(&c).helpers, vec![account("anna")]);
    c
}

// ---------- Who can change payout details ----------

#[test]
#[should_panic(expected = "only the holder can request a payout change")]
fn attacker_cannot_request_a_change() {
    let mut c = with_maria();
    act("attacker", MINUTE);
    request_near(&mut c, "attacker");
}

#[test]
#[should_panic(expected = "only the holder can request a payout change")]
fn agent_cannot_request_a_change() {
    let mut c = with_maria();
    act("agent", MINUTE);
    request_near(&mut c, "agent");
}

#[test]
#[should_panic(expected = "only the holder can request a payout change")]
fn helper_cannot_request_a_change() {
    let mut c = with_helper_anna();
    act("anna", 3 * MINUTE);
    request_near(&mut c, "anna");
}

// ---------- Waiting periods ----------

#[test]
fn first_change_waits_the_extended_period() {
    let mut c = with_maria();
    act("maria", 0);
    request_near(&mut c, "new");
    assert!(holder(&c).pending_change.unwrap().extended);

    act("maria", 5 * MINUTE - 1);
    assert_eq!(holder(&c).payout_account, account("maria"));
    act("maria", 5 * MINUTE);
    assert_eq!(holder(&c).payout_account, account("new"));
}

#[test]
fn later_change_waits_the_normal_period() {
    let mut c = with_maria_changed_once();
    act("maria", 20 * MINUTE);
    c.confirm_details();
    request_near(&mut c, "second");
    assert!(!holder(&c).pending_change.unwrap().extended);

    act("maria", 22 * MINUTE - 1);
    assert_eq!(holder(&c).payout_account, account("first"));
    act("maria", 22 * MINUTE);
    assert_eq!(holder(&c).payout_account, account("second"));
    assert_eq!(holder(&c).change_count, 2);
}

#[test]
fn recent_contact_change_extends_the_wait() {
    let mut c = with_maria_changed_once();
    act("maria", 20 * MINUTE);
    c.record_contact_change();
    act("maria", 21 * MINUTE);
    request_near(&mut c, "scammer");
    assert!(holder(&c).pending_change.unwrap().extended);

    act("maria", 25 * MINUTE);
    assert_eq!(holder(&c).payout_account, account("first"));
}

#[test]
#[should_panic(expected = "a change is already pending")]
fn only_one_change_at_a_time() {
    let mut c = with_maria();
    act("maria", 0);
    request_near(&mut c, "one");
    request_near(&mut c, "two");
}

#[test]
fn nothing_takes_effect_while_paused_or_frozen() {
    let mut c = with_maria();
    act("maria", 0);
    request_near(&mut c, "new");
    act("agent", MINUTE);
    c.pause_holder(account("maria"), HASH.into());
    act("agent", 6 * MINUTE);
    assert_eq!(holder(&c).payout_account, account("maria"));
    assert!(holder(&c).pending_change.is_some());
}

// ---------- Cancelling ----------

#[test]
fn helper_can_cancel_a_pending_change() {
    let mut c = with_helper_anna();
    act("maria", 3 * MINUTE);
    request_near(&mut c, "scammer");
    act("anna", 4 * MINUTE);
    c.cancel_payout_change(account("maria"));

    act("anna", 20 * MINUTE);
    assert_eq!(holder(&c).payout_account, account("maria"));
    assert!(holder(&c).pending_change.is_none());
}

#[test]
#[should_panic(expected = "only the holder or a helper can cancel")]
fn stranger_cannot_cancel() {
    let mut c = with_maria();
    act("maria", 0);
    request_near(&mut c, "new");
    act("attacker", MINUTE);
    c.cancel_payout_change(account("maria"));
}

// ---------- Helpers ----------

#[test]
fn a_new_helper_has_no_powers_during_the_wait() {
    let mut c = with_maria();
    act("maria", 0);
    c.add_helper(account("anna"));
    act("maria", 2 * MINUTE - 1);
    assert!(holder(&c).helpers.is_empty());
    act("maria", 2 * MINUTE);
    assert_eq!(holder(&c).helpers, vec![account("anna")]);
}

#[test]
fn a_helper_being_removed_can_still_cancel() {
    let mut c = with_helper_anna();
    act("maria", 3 * MINUTE);
    c.remove_helper(account("anna"));
    request_near(&mut c, "scammer");
    act("anna", 4 * MINUTE);
    c.cancel_payout_change(account("maria"));
    assert!(holder(&c).pending_change.is_none());

    act("anna", 5 * MINUTE);
    assert!(holder(&c).helpers.is_empty());
}

#[test]
fn removing_a_helper_alerts_on_chain() {
    let mut c = with_helper_anna();
    act("maria", 3 * MINUTE);
    c.remove_helper(account("anna"));
    assert!(get_logs()[0].contains("helper_removal_requested"));
}

// ---------- Bank changes ----------

#[test]
fn bank_change_uses_a_recent_verification() {
    let mut c = with_maria();
    act("verifier", 0);
    c.record_bank_verification(account("maria"), HASH.into());
    act("maria", MINUTE);
    c.request_payout_change(account("maria"), PayoutMethod::Bank, None, None);
    act("maria", 6 * MINUTE);
    assert_eq!(holder(&c).payout_method, PayoutMethod::Bank);
    assert_eq!(holder(&c).bank_fingerprint.as_deref(), Some(HASH));
}

#[test]
#[should_panic(expected = "bank verification is too old")]
fn stale_bank_verification_is_rejected() {
    let mut c = with_maria();
    act("verifier", 0);
    c.record_bank_verification(account("maria"), HASH.into());
    act("maria", 11 * MINUTE);
    c.request_payout_change(account("maria"), PayoutMethod::Bank, None, None);
}

#[test]
#[should_panic(expected = "only the verifier")]
fn only_the_verifier_records_bank_details() {
    let mut c = with_maria();
    act("maria", 0);
    c.record_bank_verification(account("maria"), HASH.into());
}

#[test]
fn intents_route_follows_the_same_rules() {
    let mut c = with_maria();
    let route = IntentsRoute {
        chain: "base".into(),
        asset_id: "usdc".into(),
        address: "0xabc".into(),
    };
    act("maria", 0);
    c.request_payout_change(
        account("maria"),
        PayoutMethod::Intents,
        None,
        Some(route.clone()),
    );
    act("maria", 5 * MINUTE - 1);
    assert_eq!(holder(&c).payout_method, PayoutMethod::Near);
    act("maria", 5 * MINUTE);
    assert_eq!(holder(&c).intents_route, Some(route));
}

// ---------- Status ----------

fn status(c: &Contract) -> Status {
    c.get_status(account("maria")).unwrap()
}

#[test]
fn status_follows_the_traffic_light() {
    let c = with_maria();
    act("anyone", MINUTE);
    assert_eq!(status(&c), Status::Green);
    act("anyone", 10 * MINUTE + 1);
    assert_eq!(status(&c), Status::Amber);
    act("anyone", 20 * MINUTE + 1);
    assert_eq!(status(&c), Status::Red);
}

#[test]
fn never_confirmed_is_red() {
    let mut c = contract();
    act("maria", 0);
    c.register_holder();
    assert_eq!(status(&c), Status::Red);
}

#[test]
fn pending_change_is_amber() {
    let mut c = with_maria();
    act("maria", 0);
    request_near(&mut c, "new");
    assert_eq!(status(&c), Status::Amber);
}

#[test]
fn kyc_near_expiry_is_amber_and_expired_is_red() {
    let mut c = with_maria();
    act("kyc", 0);
    c.record_kyc(account("maria"), 5 * MINUTE, Screening::Clear);
    assert_eq!(status(&c), Status::Amber);
    act("anyone", 5 * MINUTE);
    assert_eq!(status(&c), Status::Red);
}

#[test]
fn screening_review_is_red() {
    let mut c = with_maria();
    act("kyc", 0);
    c.record_kyc(account("maria"), 1_000 * MINUTE, Screening::Review);
    assert_eq!(status(&c), Status::Red);
}

#[test]
#[should_panic(expected = "only the KYC provider")]
fn only_the_kyc_provider_records_kyc() {
    let mut c = with_maria();
    act("agent", 0);
    c.record_kyc(account("maria"), 1_000 * MINUTE, Screening::Clear);
}

#[test]
fn a_bounce_is_red_until_the_holder_confirms() {
    let mut c = with_maria();
    act("admin", 0);
    c.create_company("acme".into(), "Acme".into(), account("token"), 1_000);
    c.set_holding("acme".into(), account("maria"), 1_000);
    c.mark_contact_bounced("acme".into(), account("maria"));
    assert_eq!(status(&c), Status::Red);

    act("maria", MINUTE);
    c.confirm_details();
    assert_eq!(status(&c), Status::Green);
}

// ---------- Agent, pause and freeze ----------

#[test]
fn confirming_lifts_a_pause_but_never_a_freeze() {
    let mut c = with_maria();
    act("agent", 0);
    c.pause_holder(account("maria"), HASH.into());
    assert_eq!(holder(&c).state, HolderState::Paused);
    act("maria", MINUTE);
    c.confirm_details();
    assert_eq!(holder(&c).state, HolderState::Active);

    act("agent", 2 * MINUTE);
    c.freeze_holder(account("maria"), None);
    act("maria", 3 * MINUTE);
    c.confirm_details();
    assert_eq!(holder(&c).state, HolderState::Frozen);
}

#[test]
#[should_panic(expected = "only the agent")]
fn only_the_agent_pauses() {
    let mut c = with_maria();
    act("attacker", 0);
    c.pause_holder(account("maria"), HASH.into());
}

#[test]
#[should_panic(expected = "expected a 64-character hex hash")]
fn readable_reasons_are_rejected() {
    let mut c = with_maria();
    act("agent", 0);
    c.flag_holder(account("maria"), "holder has died".into());
}

#[test]
#[should_panic(expected = "only the estate reviewer")]
fn the_agent_cannot_unfreeze() {
    let mut c = with_maria();
    act("agent", 0);
    c.freeze_holder(account("maria"), None);
    c.unfreeze_holder(account("maria"));
}

#[test]
#[should_panic(expected = "only the estate reviewer")]
fn a_helper_cannot_unfreeze() {
    let mut c = with_helper_anna();
    act("anna", 3 * MINUTE);
    c.freeze_holder(account("maria"), None);
    c.unfreeze_holder(account("maria"));
}

#[test]
fn the_reviewer_can_lift_a_mistaken_freeze() {
    let mut c = with_helper_anna();
    act("anna", 3 * MINUTE);
    c.freeze_holder(account("maria"), None);
    act("reviewer", 4 * MINUTE);
    c.unfreeze_holder(account("maria"));
    assert_eq!(holder(&c).state, HolderState::Active);
}

#[test]
#[should_panic(expected = "not allowed to freeze")]
fn a_stranger_cannot_freeze() {
    let mut c = with_maria();
    act("attacker", 0);
    c.freeze_holder(account("maria"), None);
}

#[test]
fn a_company_admin_can_freeze_their_own_holder() {
    let mut c = with_maria();
    act("admin", 0);
    c.create_company("acme".into(), "Acme".into(), account("token"), 1_000);
    c.set_holding("acme".into(), account("maria"), 1_000);
    c.freeze_holder(account("maria"), Some("acme".into()));
    assert_eq!(holder(&c).state, HolderState::Frozen);
}

#[test]
#[should_panic(expected = "not allowed to freeze")]
fn a_company_admin_cannot_freeze_someone_elses_holder() {
    let mut c = with_maria();
    act("admin", 0);
    c.create_company("acme".into(), "Acme".into(), account("token"), 1_000);
    c.freeze_holder(account("maria"), Some("acme".into()));
}

#[test]
#[should_panic(expected = "holder is not frozen")]
fn transfer_needs_a_frozen_holder() {
    let mut c = with_maria();
    act("reviewer", 0);
    c.approve_transfer(account("maria"), account("estate"));
}

#[test]
fn reviewer_transfers_a_frozen_holder() {
    let mut c = with_maria();
    act("agent", 0);
    c.freeze_holder(account("maria"), None);
    act("reviewer", MINUTE);
    c.approve_transfer(account("maria"), account("estate"));
    let h = holder(&c);
    assert_eq!(h.state, HolderState::Transferred);
    assert_eq!(h.transfer.unwrap().new_account, account("estate"));
}

// ---------- Companies ----------

#[test]
fn register_shows_shares_and_status() {
    let mut c = with_maria();
    act("admin", 0);
    c.create_company("acme".into(), "Acme".into(), account("token"), 1_000);
    c.set_holding("acme".into(), account("maria"), 400);
    let register = c.get_register("acme".into());
    assert_eq!(register.len(), 1);
    assert_eq!(register[0].shares, 400);
    assert_eq!(register[0].status, Some(Status::Green));
}

#[test]
#[should_panic(expected = "only the company admin")]
fn only_the_admin_sets_holdings() {
    let mut c = with_maria();
    act("admin", 0);
    c.create_company("acme".into(), "Acme".into(), account("token"), 1_000);
    act("agent", 0);
    c.set_holding("acme".into(), account("maria"), 400);
}

#[test]
#[should_panic(expected = "share counts are locked")]
fn holdings_are_locked_during_a_payout() {
    let mut c = with_maria();
    act("admin", 0);
    c.create_company("acme".into(), "Acme".into(), account("token"), 1_000);
    let mut company = c.get_company("acme".into()).unwrap();
    company.open_event = Some("exit".into());
    c.companies.insert("acme".into(), company);
    c.set_holding("acme".into(), account("maria"), 400);
}
