# [Project name] — simple, scam-resistant payout details for companies with many small shareholders

Built at NEAR HACKATHON (Nov 1–14, 2026). Tracks: `realworld`, `security`, `privacy`.

> Draft written before the hackathon. Sections marked TODO are filled in once the app is built.

## What it is

**An AI payment agent for exit day that keeps every shareholder verified and reachable, can't be tricked into moving money, and proves every payout matched each holder's shares, with holders known on-chain only as random accounts, never by name.**

A shareholder registry on NEAR where each investor's payout details are verified, kept current, and changeable only by the investor. It is designed for older, non-technical investors: a few large, plain-language screens, login with email or a text code, and no crypto terms. Companies use it to pay many small shareholders (for example, crowdfunding investors at an exit) without phone callbacks, without chasing bank details, and without losing track of investors.

**Built for a stablecoin-first future.** By default investors receive euros as a stablecoin in their own account in the app; anyone can choose another chain or token, paid through **NEAR Intents**; bank transfers through a licensed partner remain as today's bridge. Older investors simply see "€… received".

## Goals

1. **No more callbacks.** Shareholders keep their own details verified; companies never phone anyone to confirm a bank account.
2. **Better security.** No change takes effect without the shareholder's own strong identification, a waiting period and alerts. Nobody else, including the company and the platform operator, can change a shareholder's details.
3. **Provably correct payouts.** Every holder is paid exactly for their shares at the record date, and the totals reconcile to the smallest unit. A missed share transfer is caught before any money moves.
4. **Better investor experience.** Familiar identification, a few large plain-language screens, one update for every company, and payouts that simply arrive.

## Why we built this

Companies that raise money from hundreds of small investors often keep a shareholder register where investors log in and update their own details, but it holds no verified bank details and offers no way to pay shareholders. To pay investors at an exit, a company has to hire a payment agent, which shareholders often find complicated and hard to trust.

## The problem

- **No payout layer:** growth companies with many small shareholders have no simple, trusted way to pay dividends or exit proceeds.
- **Callbacks:** to avoid paying the wrong account, companies phone shareholders to confirm bank details. This is slow, costly and can itself be defeated.
- **Impersonation fraud:** a criminal pretends to be a shareholder and asks to change the bank account. Checking that an account matches a name does not stop this, because a criminal with stolen documents can open an account in the victim's name.
- **Coached scams:** older investors are phoned by someone posing as their bank or the company and talked into making the change themselves. A correct login does not help when the real person is being deceived.
- **Stale records:** shareholders move, change banks or die. Nobody checks whether details are still correct until a payout fails.

## Why not just a secure login?

A login answers "is this the right person at this moment?" This project adds what comes after the login.

| Risk | Login-only self-service register | This project |
|---|---|---|
| Fraudster without the shareholder's credentials | Blocked (with strong identification) | Blocked |
| Shareholder coached by a scammer | Change accepted immediately | Warning screen, waiting period, trusted helper can cancel |
| Phished or taken-over login | Attacker can change details at once | Waiting period and alerts to the existing contact details |
| Platform staff or systems change a record | Possible | Not possible; only the shareholder can request changes |
| Proof of who changed what, when | Internal logs, if any | Tamper-proof change history |
| Details still correct | Only if the shareholder remembers to update | Yearly one-tap check, bounce detection, successful payouts as evidence |
| Bank account belongs to the shareholder | Not verified | Verified when added |
| Paying shareholders | Not possible | Built in |

## How it works

1. An investor logs in with email or a text code and sets one payout destination used by every company they hold shares in.
2. To change it, they answer a safety question ("Has anyone asked you to change this?"), confirm the new account with their bank, and enter a code. Three screens.
3. Only the investor can request a change. The contract rejects requests from anyone else, including the company and the platform operator.
4. The change takes effect after a waiting period, longer for risky patterns (first-ever change, or phone/email changed recently). The investor and their **trusted helper** (e.g. a son or daughter) are alerted, and either of them can cancel.
5. Every investor is **KYC'd once** (identity, sanctions and PEP screening, tax residency) by a licensed partner, and that KYC is reused by every company they hold shares in and kept current. Only an attestation goes on-chain. Once a year the investor taps "Yes, all correct" (and re-identifies with strong identification when KYC is due). Each investor has a status: green (current), amber (getting stale or change pending), red (unreachable, too old, KYC expired or screening under review).
6. An AI **caretaker agent** keeps details current: it notices stale or bounced details, reminds investors by email, text or letter, explains things in plain language, and can pause or freeze a payout for checking. Before a payout it reconciles the register with the shareholders and reports who is ready. Its NEAR key only allows flagging, pausing, freezing and logging; it can never change payout details, set share counts or move money, and only a human can lift a freeze.
7. A company opens a payout event and the contract snapshots the holdings. Each investor confirms their share count; a different number opens a dispute. The agent proposes a correction, the company applies it, and every affected holder confirms again.
8. The company runs the payout in a stablecoin. The contract does all the arithmetic; no AI touches the amounts. Nobody is paid without valid KYC, clear screening and a confirmed share count. Green and amber investors are paid to their active account, or, if they chose another chain or token, through NEAR Intents. Anyone else's share is held in the contract until they return, confirm and claim. A failed or refunded Intents payout is held, never lost.
9. When a shareholder dies, the record is frozen and payouts are held. The agent guides the family through the estate documents, and after a human approves, the money goes to the estate.

## Provably correct payouts

Errors come from the inputs (a transfer never recorded, a stale register) far more than from the arithmetic, so people check the inputs and code checks the arithmetic.

`execute_payout` pays nothing unless every check passes:

1. The snapshot adds up to the company's total shares.
2. The funded amount equals the event total exactly.
3. No disputes are open. Unconfirmed holders don't block the payout, but their share is held.
4. Each amount = floor(total × shares ÷ total shares), in the token's smallest units.
5. In flight + queued + held + remainder = total, to the smallest unit, and that stays true as transfers finish.
6. The rounding remainder is recorded and held for the company, never lost.

**The proof:** before any money moves, the contract calculates a Merkle root of the manifest (holder, shares, amount) and publishes it. Each investor can check their own line against it. This proves the calculation was fixed and can't be altered later. It does not hide anything: share counts per random account are readable on-chain, so anyone can recompute the amounts. Privacy comes from those accounts never being linked to a name.

## Compliance: KYC kept current

- **Why it matters:** payment agents redo KYC on every investor for every payout. A register whose KYC is always current removes that cost and much of the company's risk, especially before an exit.
- **Who does it:** a licensed KYC partner (an obliged entity under anti-money-laundering law) identifies investors with strong identification, screens sanctions and politically exposed persons, and records tax residency. The platform orchestrates and keeps it current.
- **Payout gate:** expired KYC or screening under review → the share is held, never paid. Sanctions lists are re-screened continuously.
- **Reuse:** one KYC serves every company, relying on the partner's checks and with the investor's consent.
- **Crypto-ready:** the EU travel rule requires recipient information and, for larger transfers to self-held wallets, proof the wallet belongs to the recipient. The investor's signature on their registered payout route provides it.
- **On-chain:** only "KYC valid until" and a screening status; no personal data, documents or reasons.

## Privacy

- **No personal data on-chain:** no names, emails, phone numbers or bank numbers; only a bank-account fingerprint.
- **Unlinkable accounts:** investors get random account IDs, not readable names.
- **Neutral records:** the chain shows that a holder is paused, frozen or transferred, never why. A death is never recorded as a death.
- **Private AI:** the caretaker agent reads investors' messages and estate documents inside a NEAR AI Cloud enclave (Intel TDX + NVIDIA GPU TEE) with verifiable attestation; not even the operator sees them. Only hashes of its actions go on-chain.
- **The enclave protects privacy, not money:** moving funds depends only on signatures and contract rules.

**Still visible on-chain:** each random account's share count per company, payout transfers and amounts (roadmap: Confidential Intents), when a holder was paused, frozen or transferred, and each payout's manifest root and counts.

## How NEAR is used

| NEAR feature | Used for |
|---|---|
| NEAR accounts and transaction signatures | Every change is authenticated by the investor's own account instead of a phone call |
| Login (simulated) | Investors log in with email or a text code on a labelled mock login screen; their random NEAR testnet account is used invisibly. In production this would be NEAR Auth |
| Meta transactions (relayer) | Investors and helpers sign with their own key; a platform relayer submits the call and pays the network fee, so they never need NEAR. The agent pays its own small fees from its restricted key's allowance |
| Function-call access keys | Each role gets a key limited to its methods: the helper can only cancel a change or freeze the record, the AI agent can only flag, pause, freeze and log, the investor's phone key cannot touch anything else |
| Smart contract (Rust, `near-sdk-rs`) | Enforces who may change what, waiting periods, helper cancels, statuses and payout splitting, for everyone including the operator |
| NEP-141 fungible token | Stablecoin payouts (a test stablecoin on testnet) and funds held for unreachable investors |
| NEP-297 events | Alerts to investors and helpers |
| NEAR AI Cloud private inference | The caretaker agent's AI runs in a verifiable enclave, so sensitive messages and documents stay private |
| NEAR Intents (1Click API) | Pays each investor on the chain and token they choose; stretch: lets an acquirer fund a payout from any chain and token. Roadmap: Confidential Intents to keep payout amounts private |

## Try it

TODO: replace with the deployed URL, contract account and test accounts.

Live app (NEAR testnet): TODO
Contract: TODO.testnet

Steps for a judge (the in-app **Demo inbox** shows the emails and text codes that would be sent):

**First click Reset demo.** The demo's short time limits (10 minutes for a confirmation) turn every holder red, so the button deploys a fresh copy of the contract on testnet and seeds the cast with new dates.

1. Open the **Acme Robotics** company dashboard and click **Open payout**. → Payout readiness: 2 of 5 ready, **KYC current: 80%** (4 of 5 investors). The agent's report: Tom's email bounced; Peter's KYC expired; Peter says he holds 800 shares but the register says 1,000; Lena says 1,200 but the register says 1,000.
2. Open the **Agent log** and the **Demo inbox**. → The agent emailed Tom, then texted him, and paused his payouts.
3. Open the app as **Peter**, re-identify (simulated). → His KYC is current.
4. Back on the dashboard, see the agent's proposed correction: Peter's −200 and Lena's +200 are one unrecorded transfer. Click **Apply**. → Both holders go back to unconfirmed. Open the app as each and confirm. → Readiness: 4 of 5, Tom held.
5. Open the **Attacker panel** and try to change Maria's account from another account. → Rejected: "only the holder can request a payout change" (explorer link shown).
6. As **Maria (72)**, tap **Change my bank account** → **No, this is my own decision** → **Continue to my bank** (simulated) → enter the code from the Demo inbox (the "coached scam"). → The waiting period is extended to 5 minutes because her phone number changed recently.
7. Switch to **Anna (helper)**. → Alert about her mum's change. Tap **Cancel this change**. → Maria's original account stays active.
8. In the **Agent log**, click **Ask agent to redirect Maria's money**. → Rejected by NEAR: the agent's key does not allow that method (explorer link shown).
9. On the dashboard, see the checks tick green and click **Run exit payout**. → The manifest root appears on-chain first, then paid, queued and held results per investor, with explorer links. Peter and Erik (paid in euros to their accounts in the app) see "€… received". Maria chose her bank, so she sees "€… is on its way to your bank" (bank payout queued, simulated). **Lena** chose US dollars on another network: the screen shows her calculated share in the test euro and, labelled separately, the real, tiny transfer on mainnet (links to both chains' explorers). Tom's share is held.
10. As Maria, tap **Check this payment**. → ✓ her amount matches her shares and belongs to the published manifest.
11. Open the app as **Tom**, tap **Yes, all correct**, confirm his share count, then **Claim**. → Tom receives his held share.

**Also built, not in the video:**

- **Honest bank change:** after a reset, make Maria's change as above and, as Anna, tap **That's fine**. After the wait, the new account is active. Bloom Foods uses the same details.
- **Estate flow**: after a reset (wait 5 minutes for Jonas's helper role to start), open the investor app as **Jonas**, Erik's son and helper, and tap **Tell us Erik has died**. → Erik's record is frozen; on the explorer the transaction says only `freeze_holder`, and the platform paid the fee. The agent emails Jonas the next steps (Demo inbox). Open **Estate review** and click **Agent: read the documents**. → The agent reads the simulated estate documents inside the NEAR AI Cloud enclave and prepares the case; code checks that the estate account matches. Run the exit payout (Erik's share is held), then, as the human reviewer, **Approve transfer to the estate** and **Estate: collect the money**. → Erik's held money goes to the estate's account. **Lift the freeze** undoes a mistaken report; only the reviewer's key can do either.

## What is real and what is simulated

| Real (on NEAR testnet) | Simulated (labelled in the app) |
|---|---|
| Registry contract, who-can-change-what rules, waiting periods, helper cancel, statuses | Bank account verification (a verifier service writes a mock fingerprint) |
| Stablecoin payouts and held funds | Text messages and emails (shown in the Demo inbox) |
| Payout events, share-count confirmations, the payout checks and the manifest root | The scale of Lena's Intents transfer: the contract and its test euro are on testnet, while delivery is a tiny amount on mainnet from the builder's wallet, so it is much smaller than her calculated share (both are shown, labelled) |
| NEAR Intents payout to another chain (mainnet, a tiny amount) — TODO: confirm, or note fallback | |
| Event-based alerts | Payouts to bank accounts (shown as queued) |
| Caretaker agent's contract actions with its restricted key | Agent's emails, texts and letters (shown in the Demo inbox); estate documents |
| Login (mock screen; each cast member has a pre-created random testnet account whose key the demo site holds) | Strong identification (a generic screen standing in for national bank-based identification) |
| KYC payout gate and attestations | KYC provider (identity checks, sanctions and PEP screening) |
| | Euro stablecoin: a test euro token on testnet (EURC or similar in production, where available) |

## Security model

| Threat | Protection |
|---|---|
| Fraudster impersonates the investor | Only the investor's own login can request changes; the contract rejects anyone else |
| Investor is coached by a scammer | Warning screen, extended waiting period for risky patterns, helper alert and helper cancel; removing a helper also waits and alerts |
| Insider at the company or platform | Nobody but the investor can request changes; contract rules bind the operator too |
| Lost contact | Yearly one-tap check, bounce detection, caretaker agent outreach, held funds |
| Wrong share counts or an unrecorded transfer | Record-date snapshot, holder confirmations, agent cross-check, and checks that block the payout on any mismatch |
| Company shifts shares away from a silent holder | Corrections need an open dispute from the holder concerned; anyone unconfirmed is held, never paid on an unverified number |
| Rounding or arithmetic errors | Integer arithmetic in the contract, exact-total checks, remainder recorded; no AI in the calculation |
| A misbehaving or manipulated AI agent | Its function-call key only allows flag, pause, freeze and log; NEAR rejects anything else; only a human can lift a freeze; every action is logged |
| Fraud after a death | Record frozen on notice; money goes only to the estate after human review |
| Profiling from public chain data | Random unlinkable accounts, neutral method and event names, no reasons on-chain |
| Bank data exposure | Bank numbers never on-chain; in production verified inside a TEE and released only to the payment provider. Control of funds never depends on the TEE |

## Architecture

TODO: diagram.

- `contract/` — Rust smart contract (registry, rules, payouts)
- `frontend/` — Next.js app from `create-near-app` (investor, helper, company, attacker and demo-inbox views)
- `verifier/` — simulated bank verification service
- `agent/` — caretaker agent service (LLM + restricted NEAR key)
- `frontend/src/server/near.ts` (`relayedCall`) — meta transactions: the investor signs, the platform relayer pays the fee
- `payout-service/` — sends Intents payouts with a restricted key (registered routes only)
- `docs/DESIGN.md` — full design spec

## Run locally

TODO: website commands. Contract tests: `cargo test` in `contract/`. Full exit on testnet with real token transfers: `bash scripts/e2e-exit.sh <suffix> <funded-testnet-account>`.

## Tests

TODO: list of contract tests, including:
- a change requested by someone other than the holder is rejected
- a helper can cancel a pending change but cannot request one
- the waiting period is extended after a recent contact change or for a first-ever change
- a pending change does not receive payouts
- a bank change without a recent verification is rejected
- red investors' shares are held and claimable after confirmation
- a claim with expired KYC or screening under review is rejected
- confirming details lifts an agent pause but never a freeze
- a failed token transfer is recorded as held, not paid
- the agent's key can flag and pause but any other call is rejected
- a frozen holder's payouts are held, and only the estate reviewer can release them to a successor
- no method name or event reveals a reason (death, dispute) for freezing
- a holder with expired KYC or screening under review is held, not paid; only the KYC provider's key can record KYC
- an Intents route change follows the same signature, waiting-period and helper rules as any payout change
- a failed or refunded Intents payout is recorded as held, not paid
- a payout can't open unless holdings add up to total shares, and funding that isn't the exact total is refunded
- an open dispute blocks the payout; an unconfirmed holder's share is held
- a correction needs an open dispute from the holder concerned, keeps the total unchanged, updates the register, and requires re-confirmation
- amounts, remainder and totals reconcile to the smallest unit at every step, including when a transfer fails
- the manifest root is published before any money moves, and an investor's line verifies against it
- removing a helper waits and alerts; the helper can still cancel during that wait
- the agent and helpers can freeze but not unfreeze; only the reviewer can unfreeze
- the agent's key cannot set share counts

## Limitations

- The contract runs on testnet. The Intents payout uses mainnet with a tiny amount from the builder's own wallet, because Intents runs on mainnet, so that transfer is scaled down from the investor's calculated share.
- An investor who never confirms their share count is held, not paid. That is the safe default, but in a real exit it means more follow-up.
- An open payout event can't be cancelled, and a correction can only involve holders already on the register.
- In the demo, an open dispute blocks the whole payout. Production could hold just the disputed share and pay everyone else.
- Payouts are processed in one transaction, suited to a demo of up to ~10 investors. Production needs batching.
- Bank verification, KYC checks, text messages, emails and bank payouts are simulated.

## Roadmap

1. Strong identification with national bank-based identification through a certified broker, for onboarding and for approving changes; EU Digital Identity Wallets for investors abroad when available.
2. KYC through a licensed partner: identity with strong identification, sanctions and PEP screening, tax residency, continuous re-screening; reused across companies with consent.
3. Real bank verification (open banking or bank-website proofs processed in a TEE; only a fingerprint stored).
4. Euro payouts to bank accounts through a licensed payment partner, so the platform itself never holds company or investor funds.
5. Dividend tax withholding and reporting, designed with a tax expert.
6. Real text, email and letter notifications with bounce detection; phone and paper channels for investors who don't use online banking.
7. Face ID / fingerprint signing and recovery through NEAR Auth.
8. Euro stablecoin (MiCA-compliant, e.g. EURC) as the default payout currency; Intents-funded exits from any chain; Confidential Intents to keep payout amounts private.
9. Always-on caretaker agent in an enclave (e.g. IronClaw on NEAR AI Cloud), and the bank verifier inside an attested enclave.
10. Registry state on NEAR's private shard once available.
11. Batched payouts for thousands of holders.
12. Integrations with crowdfunding platforms, so their portfolio companies can pay shareholders.

## Business model (short)

Companies or the platforms they use pay per payout (well below what a payment agent charges), for escrow handling through a licensed partner, and per KYC'd investor per year for keeping the register verified and current. Investors use it free. An investor verified once is ready for every company that pays them.

## License

TODO
