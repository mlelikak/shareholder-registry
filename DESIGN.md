# Design spec — Verified Shareholder Registry (working name)

Status: planning draft, v2 (Nov 1, 2026): adds provably correct payouts (section 7d), pre-payout reconciliation by the agent, a demo script built around exit day, and grand-prize priorities (section 16a).
Target: NEAR testnet. Languages: Rust for the contract (`near-sdk-rs`, built with `cargo-near`); TypeScript for the website (`create-near-app`) and the off-chain services.

---

## 1. The idea in one paragraph

**In one line:** an AI payment agent for exit day that keeps every shareholder verified and reachable, can't be tricked into moving money, and proves every payout matched each holder's shares, with holders known on-chain only as random accounts, never by name.

A crowdfunded startup has hundreds of small investors, many of them senior people. When it is acquired, it must pay every one of them. Today the company chases investors by email for bank details, some cannot be found, and fake "please change my bank account" requests are a fraud risk. This app keeps each investor's payout details **verified, current and controlled only by the investor**, through a few large, simple screens. An investor sets their details once and every company they hold shares in uses them. A change only takes effect after a waiting period, with alerts to the investor and, if they choose, to a trusted family member who can stop it. When the company pays out, verified investors are paid instantly and money for unreachable investors is held safely until they come back to claim it.

### Vision: stablecoin-first payouts

The demo is built for where payments are heading: euro and dollar stablecoins as ordinary money, regulated in the EU under MiCA, settling in seconds across chains. Payouts are **stablecoin-first**: by default each investor receives euros as a stablecoin in their own account in the app, and can choose to be paid on another chain or token through **NEAR Intents**. Payment to a traditional bank account through a licensed partner remains available as **today's bridge**, not the core. For older investors nothing changes on screen: they see "€… received", not tokens or chains.

### Goals and how we'll show them

| Goal | What it means | How the demo proves it |
|---|---|---|
| **No more callbacks** | The company never phones anyone to confirm details | A full exit payout runs with zero manual checks |
| **Better security** | No change takes effect without the shareholder's own strong identification, a waiting period and alerts; nobody else can change their details | Attacker rejected; coached scam cancelled by the helper; payouts never reach a pending account |
| **Provably correct payouts** | Every holder is paid exactly for their shares at the record date, and the totals reconcile to the smallest unit | A missed share transfer is caught before any money moves; the payout shows its checks passing and publishes a proof each investor can check |
| **Better investor experience** | Familiar identification, few large screens, one update for all companies | Bank change in three screens; yearly check is one tap; the payout simply arrives |

### Why: what a login-only register misses

A typical shareholder register lets investors log in and edit their own details, but holds no verified bank details and offers no payouts. To pay its investors, a company has to hire a payment agent, which shareholders often find complicated and untrustworthy. A login-only register answers "is this the right person right now?" but nothing after that: changes take effect immediately, nothing checks that details are still correct, and the details can't be used to pay anyone.

## 2. Design principles

1. **The investor never sees the technology.** No "wallet", "blockchain", "sign", "transaction" or "NEAR" anywhere in the investor's screens. They log in with email or a text code (Face ID or fingerprint where their phone supports it). The platform pays all network fees.
2. **One decision per screen, in plain language.** Large text and buttons, nothing time-pressured, works the same on phone and computer.
3. **Only the investor can request a change to their payout details.** Not the company, not the platform operator, not a helper. The contract enforces this.
4. **Protect investors from being talked into a change.** For senior investors the common scam is a caller coaching the victim to make the change themselves. Warnings, longer waiting periods for risky patterns and alerts to a trusted helper are the defence.
5. **No personal data on-chain, and nothing sensitive inferable from it.** Names, emails, phone numbers and bank numbers stay off-chain. Investors use random, unlinkable account IDs (implicit accounts), not readable names. Method names and events stay neutral (`freeze_holder`, `holder_frozen`), so the chain never says *why* (death, dispute, check). Sensitive AI work (reading emails, replies and estate documents) runs inside a verifiable enclave on NEAR AI Cloud. See section 12a for exactly what remains visible.
6. **Nobody's money gets lost.** If an investor can't be reached, their share of a payout is held in the contract until they claim it.
7. **Honest about what is simulated.** Anything mocked for the demo is labelled in the app and the README.

## 3. Who is involved

| Role | What they can do |
|---|---|
| Investor (holder) | Log in, confirm details, confirm their share count before a payout, request or cancel a payout change, add or remove a trusted helper, claim held funds |
| Trusted helper (e.g. a son or daughter) | Receives alerts about the investor's changes and **can cancel** a pending change. Cannot request changes or receive the investor's money |
| Company admin | Create a company, add holdings, open and run a payout event, correct share counts after a dispute (affected holders must re-confirm), collect the rounding remainder, flag a bounced contact |
| Verifier (simulated) | Records that a bank account was verified for a holder, and its fingerprint. In production this runs inside a TEE |
| KYC provider (simulated) | A licensed partner that identifies investors, screens sanctions and politically exposed persons, and records tax residency. Writes only an attestation on-chain: KYC valid until a date, screening status |
| Caretaker agent (AI) | Reconciles the register before a payout and reports readiness; watches for stale, bounced or failed details; sends reminders; explains things in plain language; can **pause** or **freeze** a holder's payouts and **flag** cases (only a human can lift a freeze). Can never change payout details, set share counts or move money |
| Estate reviewer (human) | Approves transferring a deceased shareholder's holding and payouts to the estate after checking documents; lifts a freeze made by mistake |
| Attacker (demo only) | Tries to change an investor's payout account directly and is rejected |

All roles are NEAR testnet accounts. Investors and helpers get theirs invisibly (demo: pre-created behind the mock login; production: NEAR Auth), as random implicit accounts rather than readable names, so an account can't be linked to a person from the chain alone.

**Restricted keys (NEAR function-call access keys).** Each role holds a key that can only call the methods it needs, enforced by NEAR itself, not just by the app:

| Key | Allowed methods | Cannot |
|---|---|---|
| Helper's key | `cancel_payout_change`, `freeze_holder` | Request changes, receive money |
| Caretaker agent's key | `flag_holder`, `pause_holder`, `freeze_holder`, `log_agent_action` | Change payout details, approve transfers, move funds |
| KYC provider's key | `record_kyc` | Anything else |
| Investor's phone key | `register_holder`, `confirm_details`, `confirm_holding`, `record_contact_change`, `request_payout_change`, `cancel_payout_change`, `add_helper`, `remove_helper`, `claim` | Anything else on the account |
| Payout service's key | `release_for_route`, `report_route_result` | Choose destinations, collect ordinary payments, be repaid twice, change details |
| Estate reviewer's key | `approve_transfer`, `unfreeze_holder` | Change payout details, set share counts, move funds other than to the approved successor |

The demo shows the agent's key being **rejected by the network** when it tries to redirect money.

**Gas-free for investors (meta transactions).** Investors, helpers and the agent sign; a platform relayer submits and pays the network fee. Nobody but the platform ever needs NEAR tokens.

## 4. What the contract stores

**Holder** (keyed by the investor's NEAR account ID)
- `payout_method` — `near` (default: stablecoin to the investor's own NEAR account), `intents` (another chain and token via NEAR Intents), or `bank` (today's bridge, via a licensed partner)
- `payout_account` — NEAR account receiving stablecoin payouts (defaults to the investor's own account)
- `intents_route` — for `intents`: `{ chain, asset_id, address }`, e.g. USDC on another chain. Changing it follows exactly the same rules as any payout change: holder signature, waiting period, helper alert
- `bank_fingerprint` — scrambled code identifying the verified bank account (no account number)
- `pending_change` — optional: `{ method, new_account | new_fingerprint | new_route, requested_at, effective_at, extended }`
- `helpers` — list of trusted helper account IDs
- `pending_helper_changes` — helpers being added or removed, each with its `effective_at`; a helper being removed keeps full powers until then
- `last_confirmed_at` — when the investor last confirmed "my details are still correct"
- `contact_status` — `ok` or `bounced`
- `contact_changed_at` — when phone or email was last changed (used to detect risky patterns)
- `change_count` — number of completed payout changes
- `kyc_valid_until` — date until which the investor's KYC is valid (set only by the KYC provider)
- `screening` — `clear` or `review` (sanctions / PEP screening; `review` never says why on-chain)
- `state` — `active`, `paused` (by the agent, pending a check), `frozen` (no changes, payouts held; the reason is kept off-chain), or `transferred` (holding moved to a successor, e.g. an estate)
- `transfer` — optional: `{ new_account, approved_by, approved_at }` (no names, reasons or documents on-chain)

**Bank verification** (written only by the verifier account)
- map of holder → `{ fingerprint, verified_at }` — the latest verified bank account

**Company** (keyed by a short ID, e.g. `acme-robotics`)
- `name`, `admin`, `payout_token` (the stablecoin the company pays in; a setting, so it can be a euro stablecoin such as EURC where available, or USDC)
- `holdings` — map of investor account → number of shares
- `total_shares` — total shares outstanding, declared at `create_company` from the company's own share register; the holdings must add up to it before a payout can open

**Payout event** (keyed by an event ID, e.g. `acme-exit-1`)
- `company_id`, `total` (amount to distribute, in the token's smallest units), `record_date` (the moment `open_payout` ran, set by the contract; it cannot look back to an earlier date)
- `snapshot` — map of investor account → shares, frozen at the record date; transfers after it don't change this payout
- `confirmations` — map of investor account → `unconfirmed` (the starting value, and again after a correction), `confirmed` or `disputed` (with the number the investor gave)
- `lines` — map of investor account → shares, amount and outcome, set at execution and updated as transfers finish. Outcomes: `in_flight`, `awaiting_route`, `released`, `settling`, `paid`, `queued` or `held`
- `funded` — amount received for this event
- `state` — `preparing`, `funded` or `executed`
- `manifest_root` — set at execution (section 7d)

**Held funds**
- map of `(company, investor)` → amount waiting to be claimed
- map of company → rounding remainder waiting to be collected by the company admin

**Settings** (fixed at deploy time; short values for the demo)

| Setting | Demo | Production |
|---|---|---|
| `COOLING_OFF` | 2 minutes | 7 days |
| `EXTENDED_COOLING_OFF` (risky patterns) | 5 minutes | 14 days |
| `RECENT_CONTACT_CHANGE` window | 10 minutes | 30 days |
| `STALE_AFTER` | 10 minutes | 12 months |
| `VERIFICATION_VALID_FOR` | 10 minutes | 24 hours |

## 5. Status rules (the traffic light)

| Status | When |
|---|---|
| 🟢 Green | Confirmed within `STALE_AFTER`, contact ok, KYC valid, screening clear, no pending change |
| 🟡 Amber | Confirmation or KYC getting close to expiry, **or** a payout change is waiting to take effect |
| 🔴 Red | Contact bounced, never confirmed, confirmation far too old, KYC expired, screening under review, or share count disputed for an open payout event |

Status is calculated when read, so it is always current.

## 6. Contract actions

**Investors**
- Register (storage deposit paid by the platform) → `register_holder()`
- Confirm details are still correct; resets the clock, clears a bounce and lifts an agent pause (`paused` → `active`; never lifts `frozen`) → `confirm_details()`
- Record that phone or email changed (details themselves stay off-chain) → `record_contact_change()`
- Request a payout change → `request_payout_change({ holder_id, method, new_account?, new_route? })`
  - Rejected unless the caller **is** `holder_id` (the line the attacker demo hits).
  - For `bank`, uses the latest verifier record, which must be newer than `VERIFICATION_VALID_FOR`.
  - Waiting period is `EXTENDED_COOLING_OFF` if this is the first-ever change **or** contact details changed within `RECENT_CONTACT_CHANGE`; otherwise `COOLING_OFF`.
  - Until it takes effect, payouts go to the current account.
- Cancel a pending change → `cancel_payout_change({ holder_id })` — allowed for the investor **and their helpers**
- Add or remove a helper → `add_helper({ helper_id })`, `remove_helper({ helper_id })` (both use the normal waiting period and alert every current helper, so a scammer can't add themselves or coach the investor into removing the real helper; a helper being removed can still cancel changes until the wait ends) Pending payout changes and helper changes take effect only while the holder is `active`; they wait during a pause or freeze.
- Confirm their share count for a payout event → `confirm_holding({ event_id, shares })` — a match records `confirmed`; a different number records `disputed` and flags the holder for the agent and the company admin. A holder whose money was held can still confirm after execution; if they dispute at that point, the money stays held and the case goes to the company admin
- Claim held money → `claim({ company_id, holder_id? })` (an approved successor passes the original holder) (requires a recent confirmation, a `confirmed` share count, valid KYC, clear screening and state `active`, the same gate as a payout; pays the currently active route)

**Caretaker agent** (restricted key)
- Flag a holder for attention → `flag_holder({ holder_id, reason_hash })` (only a hash goes on-chain, so the chain never says why)
- Pause a holder's payouts until a human or the holder resolves it → `pause_holder({ holder_id, reason_hash })` (payouts for a paused holder are held, never redirected)
- Record what it did, for the audit trail → `log_agent_action({ holder_id, action, summary_hash })` (the readable summary stays off-chain; the chain holds its hash so it can be proven later)

**Freezing and transfers (used when a shareholder dies)**
- Freeze a holder → `freeze_holder({ holder_id, company_id? })` — allowed for the holder's helpers, the agent, or the admin of a company the holder has shares in (naming that company). No reason is recorded on-chain. No changes; all payouts held.
- Approve a transfer → `approve_transfer({ holder_id, new_account })` — only the estate reviewer may call this, and only for a frozen holder. Held funds and future payouts go to the successor's verified account (e.g. the estate); later, holdings can be split to heirs after the inheritance is divided.
- Lift a freeze made by mistake → `unfreeze_holder({ holder_id })` — only the human estate reviewer may call this. A wrong or malicious freeze never locks money for good; the agent and helpers can freeze but can never unfreeze.

**KYC provider (simulated)**
- Record KYC and screening → `record_kyc({ holder_id, valid_until, screening })` — only the configured KYC provider may call this. No personal data, documents or reasons on-chain.

**Verifier (simulated)**
- Record a verified bank account → `record_bank_verification({ holder_id, fingerprint })` — only the configured verifier account may call this

**Company admins**
- Create a company → `create_company({ company_id, name, payout_token, total_shares })`
- Add or update shares → `set_holding({ company_id, holder_id, shares })` (blocked while a payout event is open for that company; use `resolve_dispute` instead)
- Flag a bounced contact (simulated email bounce) → `mark_contact_bounced({ company_id, holder_id })`
- Open a payout event → `open_payout({ event_id, company_id, total })` — snapshots holdings at that moment, which becomes the record date; rejected unless the snapshot adds up to `total_shares`
- Fund it → send test stablecoins to the contract with `ft_transfer_call`, message naming the event; handled by `ft_on_transfer`. Must equal `total` exactly, otherwise the whole transfer is refunded
- Correct a disputed count → `resolve_dispute({ event_id, corrections: [{ holder_id, shares }] })` — only for holders with an open dispute, and every holder whose number changes must be part of one; corrects both the snapshot and the company's holdings, so the same error can't return at the next payout. The result must still add up to `total_shares`, and every affected holder goes back to `unconfirmed` until they confirm again
- Run the payout → `execute_payout({ event_id })` — runs the checks in section 7d; if any fails, nothing is paid
- Collect the rounding remainder → `collect_remainder({ company_id })` — company admin only, paid to the admin account

**Read-only (free):** `get_holder`, `get_status`, `get_company`, `get_register`, `get_held_funds`, `get_payout`, `get_readiness`, `get_remainder`, `get_manifest_proof`, `verify_manifest_line`

**Events** (NEP-297 log format): `payout_opened`, `holding_confirmed`, `holding_disputed`, `payout_manifest`, `payout_settled`, `payout_change_requested`, `payout_change_cancelled`, `payout_change_effective`, `helper_add_requested`, `helper_added`, `helper_removal_requested`, `helper_removed`, `payout_paid`, `payout_held`, `holder_flagged`, `holder_paused`, `agent_action`, `holder_frozen`, `holder_unfrozen`, `holder_transferred`, `kyc_recorded`. Events carry no amounts beyond what the token transfer itself shows, and never a reason. The website turns these into alerts for the investor and their helpers.

## 7. How a payout works

0. **Open and reconcile.** The admin opens a payout event; the contract snapshots holdings at the record date. The caretaker agent works through the register until every holder is confirmed, resolved or knowingly held (section 7d).
1. **Funding.** The company admin sends the payout stablecoin to the contract, tagged with `acme-robotics`. Or, with **Intents funding** (stretch), an acquirer pays from wherever its money is (e.g. USDT on Ethereum) and NEAR Intents converts it into the payout stablecoin delivered to the contract. This replaces the cross-border payment agent and much of the escrow handling.
2. **Checks, then split.** On `execute_payout`, the contract runs every check in section 7d and splits the total by the snapshot using integer arithmetic. No AI touches the amounts.
3. For each investor:
   - 🟢 or 🟡, share count `confirmed`, method `near` → paid to their **currently active** NEAR account.
   - 🟢 or 🟡, share count `confirmed`, method `intents` → the contract gives the holder's active route to the **payout service** but keeps the money. The service requests a NEAR Intents 1Click quote for the holder's chosen chain and token, delivers from its own funds, and polls until the status is final. On success the contract repays the service and records the line as paid; failure or refund is recorded as **held**, never paid. A line can only be reported once, and only if it was released for a route. Quotes are valid for about 10 minutes, so the service quotes just before sending.
   - 🟢 or 🟡, share count `confirmed`, method `bank` → recorded as queued for the licensed payment partner (simulated in the demo).
   - 🔴, paused, frozen or share count not `confirmed` → recorded as held funds. **No one is paid without valid KYC, clear screening and a confirmed share count**; their share is held until they come back and the gap is closed. An investor who never answers is held, not paid, so the company can't quietly change a silent holder's shares.
4. A held investor comes back, confirms their details and share count, and claims.
5. **Proof.** During `execute_payout`, before any money moves, the contract calculates the manifest root and emits `payout_manifest` (section 7d). Transfers finish later, so each line starts `in_flight`, `queued` or `held`; a failed transfer becomes held, never paid. When the last one finishes, `payout_settled` gives the final counts paid, queued and held.

The payout service holds a restricted key that can only call `release_for_route` and `report_route_result`. It can never touch an ordinary payment, and the money stays in the contract until delivery succeeds.

A held investor on the `intents` route is paid to their own NEAR account when they claim, because a failed route should not be retried automatically. On the `bank` route, a claim is queued.

Demo size: 5–10 investors. Production needs batching to stay within NEAR's per-transaction limits.

## 7a. The caretaker agent

An AI agent that does the work companies now do by phone: keeping details current and helping investors through problems. **It does the legwork and the talking; investors and humans make the decisions.**

What it does:
- **Watches signals:** confirmations getting old, bounced emails, failed payouts, returned letters.
- **Reaches out, escalating gently:** email → text → letter → trusted helper → a flag for a human to call. It remembers what works for each person.
- **Explains in plain language:** answers questions such as "why are you asking me this?" or "why is my change taking longer?" (local languages in production, English in the demo).
- **Prepares, never performs:** it can pre-fill a change, but the investor confirms with their own identification.
- **Clears the register before payouts:** before an exit, it works through amber and red holders first.
- **Reconciles share counts:** compares the snapshot with holders' own confirmations and looks for patterns, e.g. one holder 200 short and another 200 over is probably one unrecorded transfer. It proposes the correction with its reasoning; the company admin applies it; both holders confirm. Its key cannot set share counts.
- **Reports readiness:** "184 of 200 ready · 9 stale · 5 unreachable · 2 disputed", each with the reason and the next step.

In the demo, the agent runs as a small service whose AI calls go to **NEAR AI Cloud private inference** (must-have, section 16a): investor emails, replies and estate documents are processed inside a hardware enclave (Intel TDX + NVIDIA GPU TEE) with attestation anyone can verify, so not even the platform operator sees them. The agent shows the attestation in its log. It writes its messages to the Demo inbox and calls the contract with its restricted key. Start this on day 2–3. A standard LLM API is a last resort that needs Mike's approval, because it drops the `privacy` track.

## 7d. Getting the payout right

**Why:** at an exit, the hardest part is making sure every investor is paid exactly for the shares they hold. Errors come from the inputs (a transfer never recorded, a stale register) far more than from the arithmetic, so the design checks the inputs with people and checks the arithmetic with code.

| Step | Who | What guarantees it |
|---|---|---|
| Snapshot at the record date | Contract | Holdings frozen for this event; later transfers don't affect it |
| Holders confirm their count | Investor | A signed confirmation per holder, made through their normal login |
| Mismatches investigated | Agent proposes, admin corrects, holders re-confirm | The agent's key can't write share counts; corrections need an open dispute, must keep the total unchanged, and leave affected holders unpaid until they re-confirm |
| Amounts calculated | Contract, integer arithmetic, no AI | Same inputs always give the same result |
| Checks before paying | Contract | See below; any failure blocks the whole payout |
| Proof published | Contract | Manifest root calculated by the contract and published before money moves; each investor can check their own line |

**Checks (all must pass, or nothing is paid):**
1. The snapshot adds up to `total_shares`.
2. The funded amount equals the event total exactly.
3. No disputes are open. (Production option: hold disputed holders' shares and pay everyone else.) Holders who are `unconfirmed` don't block the payout, but their share is held.
4. Each amount = floor(total × shares ÷ total_shares), in the token's smallest units.
5. In flight + queued + held + remainder = total, to the smallest unit. As transfers finish, in-flight amounts move to paid or held, and the sum stays equal to the total at every step.
6. The remainder from rounding (less than one unit per holder) is held for the company and recorded, never lost; the admin collects it with `collect_remainder`.

**The proof:** each manifest line is holder, shares and amount, all known at execution. Outcomes are not in it, because transfers finish later; they are recorded separately as they complete. The contract calculates the **Merkle root** itself, so nobody can substitute a different calculation, and publishes it with the counts in flight, queued and held. Each investor gets their own line and the short proof that it belongs to that root, so they can check "my €… is right and is part of the same calculation everyone was paid by". Fallback if time runs short: a plain hash of the manifest, with the investor check shown as a roadmap item.

**What the proof does and doesn't hide:** it shows the calculation was fixed and can't be altered later. It is not what provides privacy: share counts per random account are readable on-chain (section 12a), so anyone can recompute the amounts. Privacy comes from those accounts never being linked to a name on-chain.

## 7b. When a shareholder dies

Shares usually pass to the deceased person's estate, and an estate inventory and an authorized representative are normally needed before anything can be paid out. The **trusted helper is a contact and safety person, not an heir**: the law decides who inherits.

1. **Notice:** the helper reports the death (off-chain, to the agent), mail returns, or a payout fails with "account closed".
2. **Protect:** the record is frozen (`freeze_holder`); no changes; all payouts held. The chain shows only "frozen", never "deceased".
3. **Guide:** the agent sends the family a short, kind explanation of the steps and documents needed (death certificate, estate inventory, authorization from the estate's parties). No pressure.
4. **Prepare:** the agent reads the documents inside the NEAR AI Cloud enclave (nothing stored on-chain, raw documents discarded) and prepares the case: estate parties, representative, estate bank account.
5. **Decide:** a human estate reviewer approves the transfer.
6. **Pay:** the contract releases held money to the estate's verified account.

In the demo this uses a fictional shareholder (not Maria) and simulated documents.

## 7c. KYC: verified once, kept current, valid for every company

**Why it matters:** a payout needs confidence that each recipient is who they claim, isn't sanctioned, and has the right tax treatment. Payment agents redo this for every payout (part of why exits cost so much to run). A register whose KYC is always current removes that cost and much of the company's risk, especially before an exit, when an acquirer's lawyers want a clean shareholder base.

**Who is responsible:** formal KYC duties fall on obliged entities under anti-money-laundering law (banks, payment institutions, investment firms, crowdfunding and crypto-asset service providers). In production a **licensed KYC partner** performs the checks; the platform orchestrates them and keeps them current. Reusing one KYC across companies relies on the partner's checks; the relying party stays responsible, and sharing needs the investor's consent (GDPR). Sanctions rules apply to everyone: nobody may make funds available to a listed person.

**How it works:**
1. **Onboarding:** strong identification with strong identification; the KYC partner verifies identity, screens sanctions and politically exposed persons, records tax residency (off-chain).
2. **On-chain:** only `kyc_valid_until` and `screening`, written by the KYC provider's restricted key.
3. **Payout gate:** expired KYC or screening under review → the share is held, never paid.
4. **Kept current:** sanctions lists re-screened continuously; full KYC refreshed periodically. The caretaker agent sends the reminders, combined with the yearly check so investors do one thing a year.
5. **Crypto payouts:** under the EU Transfer of Funds Regulation, crypto-asset service providers collect sender and recipient information and, above a legal threshold to a self-held wallet, check the wallet belongs to the recipient. The investor's signature on their registered route proves control of the destination.

**Company dashboard:** "KYC current: 80% · screening clear: 100% · expiring within 30 days: 0" (calculated from the real register; with the demo's 5 investors and Peter expired, it shows 80%; it changes if we seed more investors).

**Demo:** the KYC provider is simulated; screening and expiry are set by its key.

## 8. Off-chain pieces

| Piece | Demo version | Real version (roadmap) |
|---|---|---|
| Strong identification | A generic "strong identification" screen (no real bank names or logos) | bank-based strong identification through a certified provider, at onboarding and for approving every change |
| Login and signing | Labelled mock login with email / text code (see Login fallback below) | NEAR Auth with Face ID / fingerprint and recovery; the NEAR key signs the change that strong identification approved |
| Network fees | Relayer sponsoring meta transactions (or the platform's account as fallback) | Relayer sponsoring meta transactions |
| Caretaker agent | Small service using NEAR AI Cloud private inference (must-have; a standard LLM API only with Mike's approval); messages go to the Demo inbox | Always-on agent in an enclave (e.g. IronClaw on NEAR AI Cloud) so its key can't be taken from the host; real email/SMS/letters; local languages |
| Bank verifier | Mock verifier (stretch: run it inside a NEAR AI Cloud enclave so the contract accepts only attested results) | Open banking or bank-website proofs processed in an enclave |
| Private payouts | Plain token transfers (amounts visible) | Confidential Intents for payouts; registry on NEAR's private shard when available |
| Intents payouts | Payout service calling the 1Click API on **mainnet with tiny amounts**, each transaction confirmed by the builder; simulated route if Intents is unavailable. The contract is on testnet and the delivery on mainnet, so the amount is scaled down and paid from the builder's wallet: the app shows Lena's calculated share and, labelled separately, the real transfer | Same service at scale, licensed partner for any regulated conversion |
| Intents funding | Stretch: acquirer deposit converted via Intents into the contract | Default for cross-border exits |
| Death notices and estate documents | Helper reports the death; simulated documents | Official death data where legally permitted; documents processed privately and discarded |
| KYC and screening | Simulated KYC provider service writing attestations with its restricted key | Licensed KYC partner (identity, sanctions and PEP screening, tax residency), continuous re-screening |
| Bank verification | "Log in to your bank" screen that calls a simulated verifier service, which writes a mock fingerprint on-chain | Open banking or a bank-website proof processed in a TEE |
| Text codes / emails | Code shown on screen; emails shown in an in-app inbox | SMS and email services with bounce reporting |
| Alerts | In-app alerts for investor and helper, built from contract events | Email, text and letters |
| Bank payouts | Shown as queued | Payment provider, account number released by the TEE for that payment only |
| Cross-chain payouts | Same as the Intents payouts row: real mainnet payout of a tiny amount; if Intents is unavailable, a labelled simulated route on testnet | NEAR Intents |

**Login fallback (chosen Nov 2):** a common security product flagged the NEAR Auth testnet login page as harmful, so judges could hit the same block. The demo uses a mock login screen (same look) with pre-created testnet accounts, clearly labelled in the README. The investor experience shown is identical.

## 9. Investor screens (designed for older people)

Rules for every investor screen: large text (at least 18px body), large buttons, one decision per screen, plain words, high contrast, no countdown pressure, a visible "Call us" option, and a printable confirmation at the end of every change.

**Home**
> Hello Maria. Your details are up to date ✓
> Payments go to: **Bank ending 4821**
> [ Change my bank account ] [ Something else changed ]

**Change bank account — screen 1: safety check**
> **Has anyone asked you to change this?**
> We will never call, text or email you asking you to change your bank account. If someone did, stop here and call your helper or us.
> [ No, this is my own decision ] [ Someone asked me — stop ]

**Screen 2: confirm the new account**
> Log in to your bank to confirm the new account is yours.
> [ Continue to my bank ] *(simulated in the demo)*
> Don't use online banking? [ Send us a bank letter instead ]

**Screen 3: final security check**
> We've sent a 6-digit code to your phone ending 77.
> [ ______ ] [ Confirm ]

**Done**
> ✓ Your new account will be used from **Friday, 30 October**.
> We've told Anna (your helper). If you didn't ask for this, tap Cancel in the email or call us.
> [ Print this confirmation ]

**How would you like to be paid?** (shown once at onboarding; the first option is pre-selected)
> [ ✓ Euros to my account here — move them to my bank any time ]
> [ To my bank account ]
> [ Advanced: another currency or network ]

The advanced option shows chains and tokens in plain words ("US dollars (USDC) on Base") and is aimed at younger, crypto-comfortable investors.

**Before a payout** (from the company, explained by the agent)
> **Acme Robotics is about to pay its shareholders.** Our records show you hold **1,000 shares**. Is that right?
> [ Yes, that's right ] [ No, I hold a different number ]

**Payout received**
> **€… received from Acme Robotics.** It's in your account now.
> [ Move to my bank ] [ Keep it here ] [ Check this payment ]

**Payment queued** (for investors paid to a bank account)
> **€… from Acme Robotics is on its way to your bank account ending 4821.** Banks can take a day or two.
> [ Check this payment ]

**Check this payment**
> ✓ Your €… matches your 1,000 of Acme's 50,000 shares, and it is part of the same calculation every shareholder was paid by.

**Yearly check (email or text)**
> **Are these still correct?** Bank ending 4821 · Phone ending 77
> [ Yes, all correct ] [ Something changed ]

**Helper view (Anna)**
> Your mum Maria asked to change her bank account to one ending 9930. It takes effect on Friday.
> [ That's fine ] [ Cancel this change ]

## 10. Company and demo screens

- **Payout readiness:** for an open event, ready / stale / unreachable / disputed counts, the agent's proposed corrections with an "Apply" button, and the section 7d checks shown as ticks before "Run exit payout" is enabled.
- **Company dashboard:** register table with traffic lights, "% of investors verified current", "Simulate email bounce" per investor, "Run exit payout" with paid / queued / held results and testnet explorer links.
- **Attacker panel:** try to change Maria's payout account from another account → rejected with the contract's error and an explorer link.
- **Demo inbox:** shows the emails and text codes that would be sent, so judges can follow without real SMS.
- **Reset demo:** the demo's short time limits turn every seeded holder red within minutes, so a judge arriving days later would see all money held. This button deploys a fresh copy of the contract on testnet and seeds the cast with new dates, including Maria's recent phone change. It gives the live contract no special powers: there is no admin method for rewriting dates.

## 11. Demo script (the video: about 2 minutes)

Built around exit day, the hardest moment for a company with many small investors, and around everyday smoothness: investors update details easily, confirm payments, and tricky cases are handled without phone calls. Security gets one short beat, not attack scenes (decided Nov 9). Everything else is "also built" and shown in the README.

1. **Hook (title card):** "When a company with hundreds of small investors is sold, someone has to pay every one of them. So it hires a payment agent, and still does the hard work itself: calling investors back, explaining the agent's portal, tracking down shareholders who moved or went silent, and hoping no hacker redirects a payout. Mnemon does that work."
2. **The agent works the list:** Acme is being sold; 4 of 7 shareholders are ready. The caretaker agent, its AI in an attested NEAR AI Cloud enclave, texts Tom (his email bounced); Peter renews his expired identity check in two taps; the agent spots that Peter's −200 and Lena's +200 are one share sale the register never recorded; the admin applies the fix and both confirm with one tap.
3. **The agent can't move money:** the Agent log's "What the agent can do": its NEAR key can only flag, pause, freeze and log, and the network rejects anything else.
4. **Updating details is easy:** Maria (72) changes her bank account in a few large taps; her daughter Anna is told and taps "That's fine". Until the change takes effect, payments go to her current account.
5. **Exit day:** one click; the contract publishes the manifest root before any money moves; everyone ready is paid, Lena in USDC on another chain through NEAR Intents (delivery simulated, with a real 1Click quote); Tom's share is held. Maria taps "Check this payment" ✓.
6. **Tom comes back,** confirms his details and share count, and collects his money.
7. **Close:** "Everyone is paid. Nobody was phoned, and every amount matched its shares." No phone calls, no payment agent, and an AI that does the work but can't touch the money.

**Also built (README, not in the video):** the attacks (a stranger, the company admin, and a fraud email to the agent, all refused, the last by the NEAR network itself); the coached scam (Maria is talked into a bank change, the wait is extended because her contact details changed recently, and Anna cancels it); the second company (Bloom Foods) using the same verified details; the estate flow (on a fresh reset, before the payout, since Erik is paid in the main script).

## 12. Security model in brief

| Threat | Protection |
|---|---|
| Fraudster impersonates the investor | Changes require the investor's own login and code; the contract rejects anyone else |
| Investor is coached by a scammer | Warning screen, extended waiting period for risky patterns, helper alert and helper cancel; removing a helper also waits and alerts, so the helper can't be taken out first |
| Insider at the company or platform | No one but the investor can request changes; contract rules apply to the operator too |
| Stale or lost contact | Yearly one-tap check, bounce detection, caretaker agent outreach, held funds |
| Wrong share counts or an unrecorded transfer | Record-date snapshot, holder confirmations, agent cross-check, corrections that must keep the total unchanged, and checks that block the payout on any mismatch |
| Company shifts shares away from a silent holder | Corrections need an open dispute from the holder concerned; anyone unconfirmed is held, never paid on an unverified number |
| Rounding or arithmetic errors | Integer arithmetic in the contract, exact-total checks, remainder recorded; no AI in the calculation |
| A misbehaving or manipulated AI agent | Its function-call key can only flag, pause, freeze and log, and can't set share counts; NEAR rejects anything else; only a human can lift a freeze; every action is on the audit trail |
| Fraud after a death ("I'm the heir, pay me") | Record frozen on notice; transfers only to the estate after human review of documents |
| Paying a sanctioned or unidentified person | Payout gate: no valid KYC or screening under review → held; continuous re-screening |
| Profiling from public chain data | Random unlinkable accounts, neutral method and event names, no reasons on-chain; sensitive AI work in an enclave |
| Bank data exposure | Bank numbers never on-chain; in production checked in a TEE and released only to the payment provider. Control of funds never depends on the TEE |

**The enclave protects privacy, not money.** Known physical attacks on TEEs (e.g. TEE.fail) mean control of funds never depends on the enclave: only signatures and contract rules can move money.

## 12a. What is still visible on-chain

Honest list, for the README and judges:
- Each random account's share count per company (the account isn't linked to a name on-chain).
- Payout token transfers and their amounts (roadmap: Confidential Intents).
- That a holder is paused, frozen or transferred, and when, but never why.
- Hashes of agent actions, not their content.
- Each payout's manifest root and its counts paid, queued and held, not the individual lines.

## 13. Known gotchas to plan for

- **NEAR Auth on testnet** needs configuration; budget time and keep the mock-login fallback ready.
- **Token storage registration:** NEP-141 tokens require each receiving account to be registered (`storage_deposit`). Register accounts during onboarding; treat a failed transfer as "held".
- **Storage costs:** paid by the platform for investors, so they never need NEAR tokens.
- **Async transfers:** token transfers from a contract complete in a callback; a failure must become "held", never "paid".
- **Testnet, with one exception:** the contract runs on testnet. Intents payouts likely need **mainnet**; they use tiny amounts from the builder's own wallet, and the builder confirms every mainnet transaction. Confirmed Oct 24–25: Intents has no testnet; the 1Click API key is optional (without one, +0.25% fee).
- **Intents edge cases:** quotes expire (~10 minutes); statuses SUCCESS, FAILED, REFUNDED, INCOMPLETE_DEPOSIT must all map to paid or held.
- **Known limits of the demo contract:** an open payout has no cancel; a holder who disputes and never agrees blocks it until the company resolves it; a correction can only involve holders already on the register.
- **Euro stablecoin availability:** whether EURC (or another MiCA-compliant euro stablecoin) is available on NEAR and in Intents is unconfirmed; the payout token is a setting, and the demo uses a test euro token on testnet.

## 14. Hackathon tracks

- `realworld` — stablecoin-first payouts through NEAR Intents, and a product ordinary people, including older investors, can use
- `security` — investor-controlled changes, waiting periods, helper protection, and an AI agent with restricted function-call keys that can help but never move money
- `privacy` (NEAR AI Cloud is now a must-have, see 16a) — unlinkable accounts, neutral on-chain records, and a caretaker agent that reads sensitive messages and estate documents only inside a verifiable NEAR AI Cloud enclave

All three tracks feed the grand prize, which rewards one coherent story: an agent doing a real finance job, privately, that provably can't misuse money.

## 15. Production context

- **Identification:** production uses existing trusted identification rather than competing with it: it proves *who* the person is; the contract decides *what is allowed* and *when it takes effect*.
- **Who it's for:** companies outside a central securities depository keep their own shareholder register. Joining one is a high hurdle for a company with hundreds of small investors. Positioning: book-entry convenience for companies too small for book-entry.
- **Money, today and tomorrow:** today most investors expect euros in their bank account, so bank payouts through a licensed partner stay available. The product is built for a stablecoin-first future: euro stablecoins regulated under MiCA as the default, NEAR Intents for any chain or token, and bank transfers as a bridge that matters less over time. Converting or transferring crypto for others may require a crypto-asset service licence (MiCA), so production runs through licensed partners.
- **KYC:** done by a licensed partner using strong identification; kept current and reused across companies with the investor's consent. The EU's new single AML regulation applies from July 2027, which favours compliance built in.
- **Tax:** dividends to individuals require withholding and reporting to the tax authority. Automating this is a likely key feature, to be designed with a tax expert.
- **Language:** production in local languages (English for the hackathon demo).
- **Investors abroad:** EU Digital Identity Wallets once available.
- **Legal check before real money:** which activities need a payment-services or crypto-asset licence, and who legally holds unclaimed funds.

## 16. Open decisions (for Nov 1)

- Project name
- Whether NEAR Auth works on testnet in the first days, or we switch to the fallback early. Decided Nov 2: mock login (see Login fallback)
- Merkle-root payout check, or plain manifest hash as fallback

## 16a. Priorities for the grand prize

The grand prize goes to one coherent, polished story, so depth on exit day beats breadth.

**Never cut:** the payout checks and manifest (7d); the agent's reconciliation catching the missed transfer; the agent being rejected by the network; the coached-scam scene; the exit payout.

**NEAR AI Cloud moves from should-have to must-have.** Without it there is no `privacy` track and the agent is an ordinary chatbot. Start it on day 2–3, not at the end.

**Cut order if behind:** stretch items → estate flow → second company → NEAR Auth (labelled mock login) → relayer → Merkle check (plain hash) → Intents payout (labelled simulation) → NEAR AI Cloud last.

**CLAUDE.md, the plan doc and the README** must match this section; CLAUDE.md follows it, and it wins over the plan until the plan is updated.
