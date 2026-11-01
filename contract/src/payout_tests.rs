use super::*;
use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{PromiseResult, testing_env};

const MINUTE: u64 = 60_000;
const TOTAL: u128 = 1_000_001;

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn act(caller: &str, now_ms: u64) {
    testing_env!(
        VMContextBuilder::new()
            .predecessor_account_id(account(caller))
            .block_timestamp(now_ms * 1_000_000)
            .build()
    );
}

/// A callback running after a token transfer that worked or failed.
fn callback(now_ms: u64, success: bool) {
    let result = if success {
        PromiseResult::Successful(vec![])
    } else {
        PromiseResult::Failed
    };
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(account("registry"))
            .predecessor_account_id(account("registry"))
            .block_timestamp(now_ms * 1_000_000)
            .build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

const HOLDERS: [(&str, u64); 3] = [("peter", 1_000), ("lena", 1_000), ("tom", 1_000)];

/// Three confirmed, KYC'd holders of "acme", with an open event.
fn opened() -> Contract {
    act("deployer", 0);
    let mut c = Contract::new(
        Config {
            cooling_off_ms: 2 * MINUTE,
            extended_cooling_off_ms: 5 * MINUTE,
            recent_contact_change_ms: 10 * MINUTE,
            stale_after_ms: 10 * MINUTE,
            verification_valid_for_ms: 10 * MINUTE,
        },
        Roles {
            verifier: account("verifier"),
            kyc_provider: account("kyc"),
            agent: account("agent"),
            estate_reviewer: account("reviewer"),
            payout_service: account("service"),
        },
    );
    for (name, _) in HOLDERS {
        act(name, 0);
        c.register_holder();
        c.confirm_details();
        act("kyc", 0);
        c.record_kyc(account(name), 1_000 * MINUTE, Screening::Clear);
    }
    act("admin", 0);
    c.create_company("acme".into(), "Acme".into(), account("token"), 3_000);
    for (name, shares) in HOLDERS {
        c.set_holding("acme".into(), account(name), shares);
    }
    c.open_payout("exit".into(), "acme".into(), U128(TOTAL));
    c
}

fn fund(c: &mut Contract) {
    act("token", 0);
    let refund = c.ft_on_transfer(account("admin"), U128(TOTAL), "exit".into());
    assert_eq!(refund.0, 0);
}

fn confirm_all(c: &mut Contract) {
    for (name, shares) in HOLDERS {
        act(name, 0);
        c.confirm_holding("exit".into(), shares);
    }
}

fn ready() -> Contract {
    let mut c = opened();
    fund(&mut c);
    confirm_all(&mut c);
    c
}

fn execute(c: &mut Contract) {
    act("admin", 0);
    c.execute_payout("exit".into());
}

fn line(c: &Contract, name: &str) -> Line {
    c.get_payout("exit".into()).unwrap().event.lines[&account(name)].clone()
}

fn totals(c: &Contract) -> PayoutTotals {
    c.get_payout("exit".into()).unwrap().totals
}

fn assert_adds_up(c: &Contract) {
    let t = totals(c);
    assert_eq!(t.paid + t.queued + t.held + t.in_flight + t.remainder, TOTAL);
}

// ---------- Opening and funding ----------

#[test]
#[should_panic(expected = "holdings don't add up to total shares")]
fn a_payout_cannot_open_if_holdings_do_not_add_up() {
    let mut c = opened();
    act("admin", 0);
    c.create_company("beta".into(), "Beta".into(), account("token"), 5_000);
    c.set_holding("beta".into(), account("tom"), 100);
    c.open_payout("beta-exit".into(), "beta".into(), U128(TOTAL));
}

#[test]
#[should_panic(expected = "only the company admin")]
fn only_the_admin_opens_a_payout() {
    let mut c = opened();
    act("attacker", 0);
    c.open_payout("x".into(), "acme".into(), U128(TOTAL));
}

#[test]
fn funding_of_the_wrong_amount_is_refunded() {
    let mut c = opened();
    act("token", 0);
    let refund = c.ft_on_transfer(account("admin"), U128(TOTAL - 1), "exit".into());
    assert_eq!(refund.0, TOTAL - 1);
    assert_eq!(
        c.get_payout("exit".into()).unwrap().event.state,
        PayoutState::Preparing
    );
}

#[test]
fn a_fake_token_cannot_fund_a_payout() {
    let mut c = opened();
    act("fake-token", 0);
    let refund = c.ft_on_transfer(account("admin"), U128(TOTAL), "exit".into());
    assert_eq!(refund.0, TOTAL);
}

#[test]
fn only_the_company_admin_can_fund() {
    let mut c = opened();
    act("token", 0);
    let refund = c.ft_on_transfer(account("attacker"), U128(TOTAL), "exit".into());
    assert_eq!(refund.0, TOTAL);
}

// ---------- The checks ----------

#[test]
#[should_panic(expected = "the payout is not funded")]
fn an_unfunded_payout_cannot_run() {
    let mut c = opened();
    confirm_all(&mut c);
    execute(&mut c);
}

#[test]
#[should_panic(expected = "check failed: a dispute is open")]
fn an_open_dispute_blocks_the_whole_payout() {
    let mut c = ready();
    act("peter", 0);
    c.confirm_holding("exit".into(), 800);
    execute(&mut c);
}

#[test]
#[should_panic(expected = "the payout has already run")]
fn the_same_payout_cannot_run_twice() {
    let mut c = ready();
    execute(&mut c);
    act("admin", 0);
    c.resolve_dispute(
        "exit".into(),
        vec![Correction {
            holder_id: account("tom"),
            shares: 1,
        }],
    );
}

#[test]
#[should_panic(expected = "the payout is not funded")]
fn execute_twice_is_refused() {
    let mut c = ready();
    execute(&mut c);
    execute(&mut c);
}

#[test]
#[should_panic(expected = "only the company admin")]
fn only_the_admin_runs_the_payout() {
    let mut c = ready();
    act("agent", 0);
    c.execute_payout("exit".into());
}

// ---------- The arithmetic ----------

#[test]
fn amounts_are_floored_and_the_remainder_is_recorded() {
    let mut c = ready();
    execute(&mut c);
    assert_eq!(line(&c, "peter").amount, 333_333);
    assert_eq!(line(&c, "lena").amount, 333_333);
    assert_eq!(line(&c, "tom").amount, 333_333);
    assert_eq!(totals(&c).remainder, 2);
    assert_eq!(c.get_remainder("acme".into()).0, 2);
    assert_adds_up(&c);
}

#[test]
fn it_adds_up_at_every_step_even_when_a_transfer_fails() {
    let mut c = ready();
    execute(&mut c);
    assert_adds_up(&c);

    callback(0, true);
    c.on_payout_transfer("exit".into(), account("peter"), U128(333_333));
    assert_adds_up(&c);

    callback(0, false);
    c.on_payout_transfer("exit".into(), account("lena"), U128(333_333));
    assert_adds_up(&c);

    let t = totals(&c);
    assert_eq!(t.paid, 333_333);
    assert_eq!(t.held, 333_333);
    assert_eq!(t.in_flight, 333_333);
}

// ---------- Corrections ----------

fn disputed_transfer() -> Contract {
    let mut c = ready();
    act("peter", 0);
    c.confirm_holding("exit".into(), 800);
    act("lena", 0);
    c.confirm_holding("exit".into(), 1_200);
    c
}

fn corrections() -> Vec<Correction> {
    vec![
        Correction {
            holder_id: account("peter"),
            shares: 800,
        },
        Correction {
            holder_id: account("lena"),
            shares: 1_200,
        },
    ]
}

#[test]
fn a_correction_updates_the_register_and_needs_reconfirming() {
    let mut c = disputed_transfer();
    act("admin", 0);
    c.resolve_dispute("exit".into(), corrections());

    let company = c.get_company("acme".into()).unwrap();
    assert_eq!(company.holdings[&account("peter")], 800);
    assert_eq!(company.holdings[&account("lena")], 1_200);
    let event = c.get_payout("exit".into()).unwrap().event;
    assert_eq!(
        event.confirmations[&account("peter")],
        Confirmation::Unconfirmed
    );
}

#[test]
fn a_corrected_holder_who_does_not_reconfirm_is_held() {
    let mut c = disputed_transfer();
    act("admin", 0);
    c.resolve_dispute("exit".into(), corrections());
    act("lena", 0);
    c.confirm_holding("exit".into(), 1_200);
    execute(&mut c);
    assert_eq!(line(&c, "peter").outcome, Outcome::Held);
    assert_eq!(line(&c, "lena").outcome, Outcome::InFlight);
}

#[test]
#[should_panic(expected = "a correction needs an open dispute from that holder")]
fn the_company_cannot_shift_shares_from_a_silent_holder() {
    let mut c = disputed_transfer();
    act("admin", 0);
    c.resolve_dispute(
        "exit".into(),
        vec![
            Correction {
                holder_id: account("lena"),
                shares: 1_200,
            },
            Correction {
                holder_id: account("tom"),
                shares: 800,
            },
        ],
    );
}

#[test]
#[should_panic(expected = "corrections must keep the total unchanged")]
fn a_correction_must_keep_the_total() {
    let mut c = disputed_transfer();
    act("admin", 0);
    c.resolve_dispute(
        "exit".into(),
        vec![Correction {
            holder_id: account("peter"),
            shares: 800,
        }],
    );
}

#[test]
#[should_panic(expected = "only the company admin")]
fn the_agent_cannot_apply_a_correction() {
    let mut c = disputed_transfer();
    act("agent", 0);
    c.resolve_dispute("exit".into(), corrections());
}

#[test]
#[should_panic(expected = "holder is not in this payout")]
fn a_stranger_cannot_confirm_a_holding() {
    let mut c = ready();
    act("attacker", 0);
    c.confirm_holding("exit".into(), 1_000);
}

// ---------- Who gets paid ----------

#[test]
fn a_silent_holder_is_held_not_paid() {
    let mut c = opened();
    fund(&mut c);
    act("peter", 0);
    c.confirm_holding("exit".into(), 1_000);
    execute(&mut c);
    assert_eq!(line(&c, "peter").outcome, Outcome::InFlight);
    assert_eq!(line(&c, "tom").outcome, Outcome::Held);
    assert_eq!(c.get_held_funds("acme".into(), account("tom")).0, 333_333);
}

#[test]
fn red_paused_frozen_and_expired_holders_are_held() {
    let mut c = ready();
    act("admin", 0);
    c.mark_contact_bounced("acme".into(), account("tom"));
    act("agent", 0);
    c.pause_holder(
        account("peter"),
        "ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12".into(),
    );
    act("kyc", 0);
    c.record_kyc(account("lena"), 0, Screening::Clear);
    execute(&mut c);
    for name in ["tom", "peter", "lena"] {
        assert_eq!(line(&c, name).outcome, Outcome::Held, "{name}");
    }
    assert_adds_up(&c);
}

#[test]
fn a_change_still_cooling_off_gets_nothing() {
    let mut c = ready();
    act("tom", 0);
    c.request_payout_change(
        account("tom"),
        PayoutMethod::Near,
        Some(account("scammer")),
        None,
    );
    execute(&mut c);
    assert_eq!(line(&c, "tom").outcome, Outcome::InFlight);
    assert_eq!(
        c.get_holder(account("tom")).unwrap().payout_account,
        account("tom")
    );
}

#[test]
fn bank_holders_are_queued() {
    let mut c = ready();
    act("verifier", 0);
    c.record_bank_verification(
        account("peter"),
        "ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12".into(),
    );
    act("peter", 0);
    c.request_payout_change(account("peter"), PayoutMethod::Bank, None, None);
    act("peter", 5 * MINUTE);
    c.confirm_details();
    act("admin", 5 * MINUTE);
    c.execute_payout("exit".into());
    assert_eq!(line(&c, "peter").outcome, Outcome::Queued);
    assert_adds_up(&c);
}

// ---------- Claims ----------

fn tom_held() -> Contract {
    let mut c = opened();
    fund(&mut c);
    execute(&mut c);
    c
}

#[test]
#[should_panic(expected = "share count must be confirmed first")]
fn a_claim_needs_a_confirmed_share_count() {
    let mut c = tom_held();
    act("tom", MINUTE);
    c.claim("acme".into(), None);
}

#[test]
fn a_held_holder_confirms_then_claims() {
    let mut c = tom_held();
    act("tom", MINUTE);
    c.confirm_details();
    c.confirm_holding("exit".into(), 1_000);
    c.claim("acme".into(), None);
    assert_eq!(c.get_held_funds("acme".into(), account("tom")).0, 0);

    callback(MINUTE, true);
    c.on_claim_transfer(
        "acme".into(),
        account("tom"),
        U128(333_333),
        vec!["exit".into()],
    );
    assert_eq!(line(&c, "tom").outcome, Outcome::Paid);
    assert_adds_up(&c);
}

#[test]
fn a_failed_claim_goes_back_to_held() {
    let mut c = tom_held();
    act("tom", MINUTE);
    c.confirm_details();
    c.confirm_holding("exit".into(), 1_000);
    c.claim("acme".into(), None);

    callback(MINUTE, false);
    c.on_claim_transfer(
        "acme".into(),
        account("tom"),
        U128(333_333),
        vec!["exit".into()],
    );
    assert_eq!(c.get_held_funds("acme".into(), account("tom")).0, 333_333);
    assert_eq!(line(&c, "tom").outcome, Outcome::Held);
}

#[test]
#[should_panic(expected = "nothing to claim")]
fn a_claim_cannot_be_repeated() {
    let mut c = tom_held();
    act("tom", MINUTE);
    c.confirm_details();
    c.confirm_holding("exit".into(), 1_000);
    c.claim("acme".into(), None);
    c.claim("acme".into(), None);
}

#[test]
#[should_panic(expected = "only the holder can claim")]
fn nobody_else_can_claim() {
    let mut c = tom_held();
    act("attacker", MINUTE);
    c.claim("acme".into(), Some(account("tom")));
}

#[test]
#[should_panic(expected = "details or KYC need attention first")]
fn expired_kyc_blocks_a_claim() {
    let mut c = tom_held();
    act("tom", MINUTE);
    c.confirm_details();
    c.confirm_holding("exit".into(), 1_000);
    act("kyc", MINUTE);
    c.record_kyc(account("tom"), 0, Screening::Clear);
    act("tom", MINUTE);
    c.claim("acme".into(), None);
}

#[test]
fn an_approved_successor_claims_for_a_transferred_holder() {
    let mut c = tom_held();
    act("agent", MINUTE);
    c.freeze_holder(account("tom"), None);
    act("reviewer", MINUTE);
    c.approve_transfer(account("tom"), account("estate"));
    act("estate", MINUTE);
    c.claim("acme".into(), Some(account("tom")));
    assert_eq!(c.get_held_funds("acme".into(), account("tom")).0, 0);
}

// ---------- Intents routes ----------

fn lena_on_intents() -> Contract {
    let mut c = ready();
    act("lena", 0);
    c.request_payout_change(
        account("lena"),
        PayoutMethod::Intents,
        None,
        Some(IntentsRoute {
            chain: "base".into(),
            asset_id: "usdc".into(),
            address: "0xabc".into(),
        }),
    );
    act("lena", 5 * MINUTE);
    c.confirm_details();
    act("admin", 5 * MINUTE);
    c.execute_payout("exit".into());
    c
}

#[test]
fn a_route_stays_in_the_contract_until_it_succeeds() {
    let mut c = lena_on_intents();
    assert_eq!(line(&c, "lena").outcome, Outcome::AwaitingRoute);
    act("service", 5 * MINUTE);
    let route = c.release_for_route("exit".into(), account("lena"));
    assert_eq!(route.address, "0xabc");
    assert_adds_up(&c);

    c.report_route_result("exit".into(), account("lena"), RouteResult::Success);
    callback(5 * MINUTE, true);
    c.on_payout_transfer("exit".into(), account("lena"), U128(333_333));
    assert_eq!(line(&c, "lena").outcome, Outcome::Paid);
    assert_adds_up(&c);
}

fn route_result_is_held(result: RouteResult) {
    let mut c = lena_on_intents();
    act("service", 5 * MINUTE);
    c.release_for_route("exit".into(), account("lena"));
    c.report_route_result("exit".into(), account("lena"), result);
    assert_eq!(line(&c, "lena").outcome, Outcome::Held);
    assert_eq!(c.get_held_funds("acme".into(), account("lena")).0, 333_333);
    assert_adds_up(&c);
}

#[test]
fn a_failed_route_is_held() {
    route_result_is_held(RouteResult::Failed);
}

#[test]
fn a_refunded_route_is_held() {
    route_result_is_held(RouteResult::Refunded);
}

#[test]
fn an_incomplete_deposit_is_held() {
    route_result_is_held(RouteResult::IncompleteDeposit);
}

#[test]
#[should_panic(expected = "this line was not released for a route")]
fn the_service_cannot_be_repaid_twice() {
    let mut c = lena_on_intents();
    act("service", 5 * MINUTE);
    c.release_for_route("exit".into(), account("lena"));
    c.report_route_result("exit".into(), account("lena"), RouteResult::Success);
    c.report_route_result("exit".into(), account("lena"), RouteResult::Success);
}

#[test]
#[should_panic(expected = "this line was not released for a route")]
fn the_service_cannot_collect_an_ordinary_payment() {
    let mut c = lena_on_intents();
    act("service", 5 * MINUTE);
    c.report_route_result("exit".into(), account("peter"), RouteResult::Success);
}

#[test]
#[should_panic(expected = "this line is not waiting for a route")]
fn the_service_cannot_release_an_ordinary_payment() {
    let mut c = lena_on_intents();
    act("service", 5 * MINUTE);
    c.release_for_route("exit".into(), account("peter"));
}

#[test]
#[should_panic(expected = "only the payout service")]
fn the_agent_cannot_release_money() {
    let mut c = lena_on_intents();
    act("agent", 5 * MINUTE);
    c.release_for_route("exit".into(), account("lena"));
}

// ---------- Proof and remainder ----------

#[test]
fn each_investor_can_verify_their_line() {
    let mut c = ready();
    execute(&mut c);
    for (name, shares) in HOLDERS {
        let proof = c.get_manifest_proof("exit".into(), account(name));
        assert!(c.verify_manifest_line(
            "exit".into(),
            account(name),
            shares,
            U128(333_333),
            proof
        ));
    }
}

#[test]
fn a_wrong_amount_fails_the_proof() {
    let mut c = ready();
    execute(&mut c);
    let proof = c.get_manifest_proof("exit".into(), account("tom"));
    assert!(!c.verify_manifest_line(
        "exit".into(),
        account("tom"),
        1_000,
        U128(333_334),
        proof
    ));
}

#[test]
fn the_admin_collects_the_remainder_once() {
    let mut c = ready();
    execute(&mut c);
    act("admin", 0);
    c.collect_remainder("acme".into());
    assert_eq!(c.get_remainder("acme".into()).0, 0);
}

#[test]
#[should_panic(expected = "only the company admin")]
fn only_the_admin_collects_the_remainder() {
    let mut c = ready();
    execute(&mut c);
    act("attacker", 0);
    c.collect_remainder("acme".into());
}

#[test]
fn share_counts_unlock_after_the_payout() {
    let mut c = ready();
    execute(&mut c);
    act("admin", 0);
    c.set_holding("acme".into(), account("tom"), 1_000);
}

#[test]
fn readiness_shows_a_dispute_as_red() {
    let mut c = ready();
    act("peter", 0);
    c.confirm_holding("exit".into(), 800);
    let lines = c.get_readiness("exit".into());
    let peter = lines
        .iter()
        .find(|l| l.holder_id == account("peter"))
        .unwrap();
    assert_eq!(peter.status, Status::Red);
    assert!(!peter.ready);
    assert_eq!(lines.iter().filter(|l| l.ready).count(), 2);
}
