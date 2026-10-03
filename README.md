# Claimdesk — pay every winner by link

**Prize, bounty and grant programs fund a payout batch once. Each winner opens a link, creates a passkey and receives stablecoins on Tempo — no gas, no seed phrase, no "please reply with your wallet address" email. The money cannot move until the organizer has cleared that winner's paperwork, and that rule is enforced on-chain.**

Crypto World's Fair Hackathon (Colosseum, Fall 2026) · Tempo track · solo founder · all code written during the hackathon (first commit 2026-10-04 KST — see `git log`).

## The problem, in this hackathon's own rules
> "All prizes … will be provided to the Team Leader. Each winning team may be required to set up a wallet address, as directed by Administrator." — Official Rules §15(b)
>
> "Winning is contingent upon the execution of Prize Acceptance Documents … and passing of the due diligence requirements" — Official Rules §13

Behind those two sentences is an operator collecting addresses, tax forms and signed documents from every winning team — and the last Colosseum hackathon drew 2,857 submissions from builders in 150 countries — then pasting 42-character addresses into a wallet by hand. On the other side is a winner who may never have held a wallet.

I'm on the winner's side of that email. I'm a solo builder and engineering student in South Korea who sells software abroad and enters global competitions. My payout path today is Paddle → Payoneer ($100 minimum, no payout in KRW) → bank, plus a Wise account still waiting on an identity check.

## What Claimdesk does
```
organizer                         escrow (Tempo)                          winner
─────────                         ──────────────                          ──────
winners.csv ──► fund(award) ────► Funded   (32-byte memo = award ref)
paperwork done ► clear(award) ──► Cleared  (only a hash of the record)
send link  ─────────────────────────────────────────────────────────────► opens link
                                                                          creates passkey (= account)
                 claim(award, me, sig) ◄── signed by the passkey; fee paid by the organizer's fee payer
                                  Claimed ── TIP-20 transferWithMemo ──► receives $, receipt in local currency
after expiry ──► reclaim(award) ► Reclaimed ── back to the organizer
```
- **Paperwork gate on-chain.** `claim()` reverts `NotCleared` until the organizer calls `clear()` with a hash of its paperwork record (tax form, identity check, acceptance). The record itself stays off-chain.
- **Link = authority, not the server.** Each link carries a one-time claim key in the URL fragment (never sent to a server). The escrow only pays the recipient that key signed for — copying a signature and swapping the address reverts `BadClaimSignature`.
- **Winner pays nothing and installs nothing.** The passkey (fingerprint / face unlock) *is* the Tempo account. The organizer's relay co-signs the fee as fee payer, and only for `claim()` calls into its own escrow.
- **Every payout reconciles.** The award reference rides as the TIP-20 transfer memo; the organizer's status page is rebuilt from the escrow's events, not a database.
- **A receipt the winner can file.** Amount, tx, block time, memo, and the amount in the winner's currency at the ECB reference rate published on or before the payment date.
- **Unclaimed money comes back.** After expiry the organizer reclaims each award with its memo.

## Why Tempo
Transfer memos, native fee sponsorship (fee payer signature — no paymaster, bundler or EntryPoint) and WebAuthn passkey accounts are protocol features on Tempo. Claimdesk is those three features pointed at one job.

## Proof — live on Tempo Moderato testnet (chain 42431)
| What | Evidence |
|---|---|
| Sponsored claim: winner 0 → 25 pathUSD in 1.1 s | tx [`0x0a53e470…34423`](https://explore.testnet.tempo.xyz/tx/0x0a53e4709da9fe7307904d67c1b4e224b67bdbd7e649e25cf9154e9f49834423) · `docs/live/moderato-2026-10-03T22-10-19-646Z.json` |
| Refused before paperwork / twice / redirected / after expiry | `NotCleared` · `AlreadySettled` · `BadClaimSignature` · `Expired` (same log) |
| Unclaimed award returned to the organizer | tx [`0xc50961df…a216`](https://explore.testnet.tempo.xyz/tx/0xc50961dfc241c4510f6b2083eec00770438ed0b6121e84e201d7fb30a7faa216) |
| Passkey account claims through the web page, fee paid by the organizer's relay (WebAuthn signature + fee-payer signature on one Tempo transaction) | tx [`0xee5da092…e7a8`](https://explore.testnet.tempo.xyz/tx/0xee5da092833b0b9c2058c3746cd8d15a46ded34c13f7dbead40c0cb8c618e7a8) — $10,000 test award, 1.7 s |

Testnet only: test stablecoins from the public faucet, testnet keys created by the scripts. No real funds.

## Run it (5 minutes, no accounts, no API keys)
```bash
npm install
forge test                          # 11 contract tests (Foundry)
npm test                            # 21 TypeScript tests (domain, application, adapters, sponsorship policy)
npm run e2e:moderato                # the whole flow on Tempo testnet, writes docs/live/moderato-*.json

# organizer + winner by hand
npm run cli -- deploy               # escrow + faucet (testnet key saved to .env.local, git-ignored)
npm run cli -- batch examples/winners.csv --days 14   # private claim links → batches/
npm run cli -- clear WF-DEMO-01 --paperwork "W-8BEN received, identity checked"
npm run serve                       # open a link from batches/ at http://localhost:5174/claim#…
npm run cli -- status
```

## Architecture (Clean Architecture, spec first: [SPEC.md](SPEC.md))
```
contracts/ClaimEscrow.sol     fund · clear · claim · reclaim · statusOf (Foundry tests in contracts/test)
src/domain/                   memo · claim link · winners list · award status machine · receipt   (pure)
src/application/              createBatch · fundBatch · claimAward · statusBoard · receiptFor     (ports only)
src/adapters/                 Tempo escrow + sponsored submitter (viem/tempo) · ECB rates (frankfurter)
src/infrastructure/           organizer CLI · local server (claim page, status page, sponsoring relay)
web/                          claim page (passkey) · status page
```
A test fails if domain or application code imports an SDK, `node:` or an adapter.

## Business
- **Wedge:** programs that pay many people they have never met — hackathons, bounty boards, ecosystem grants. Colosseum alone pays prizes to dozens of teams twice a year; Superteam Earn's public stats endpoint reports $15.9M in total value (read 2026-10-04).
- **Where it goes:** cross-border payouts to contributors and creators. The incumbent, Payoneer, moved **$87.5B** in 2025 at a **120 bps** take rate (FY2025 results, SEC exhibit 99.1, 2026-02-26).
- **Model (plan, not yet charged):** organizer pays per settled payout (fee sponsorship is already on the organizer); winners pay nothing.
- **Next 4 weeks:** one real program as a pilot · mainnet escrow · plug-in KYC / tax-form providers behind `clear()` · email-only claim for winners without passkey-capable devices.

## Honest limits
- Testnet only. Paperwork is whatever the organizer hashes into `clear()` — Claimdesk does not run KYC or give tax advice.
- The claim link is a bearer secret until paperwork is cleared and claimed; organizers should send it to the verified winner only (the paperwork gate limits damage: an uncleared link pays nothing).
- No users yet.

## Disclosure
Built solo during the hackathon with AI coding assistants (Claude). No pre-existing code. MIT license.
