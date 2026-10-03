# Claimdesk — SPEC (SDD, v0.1 2026-10-04)

## 0. One line
Pay every winner by link: an organizer funds a payout batch once, each winner opens a claim link, makes a passkey account and receives stablecoins on Tempo with no gas, no seed phrase and no "send us your wallet address" email — and the money only moves after that winner's paperwork is cleared, on-chain.

## 1. Success criteria (numbers) · deadline (constant) · non-goals
- Moderato testnet, measured: ≥1 claim paid · ≥1 claim refused for missing paperwork · ≥1 repeat claim refused · ≥1 expired award reclaimed by the organizer — each with a transaction hash.
- Winner pays 0 gas (fee sponsored) · link opened → money received ≤ 60 s · every payout carries a 32-byte memo that maps back to the award.
- Receipt shows: amount, token, tx hash, block time (UTC), memo, and the amount in the winner's local currency at the block date (ECB reference rate) with the rate's source and date.
- All tests green (contract + TypeScript) · pitch ≤ 3:00 · demo ≤ 3:00.
- Deadline: contest ends 2026-10-12 23:59 PT (= 2026-10-13 15:59 KST); internal freeze 2026-10-11 20:00 KST.
- Non-goals (v0.1): real KYC vendor, tax advice, mainnet funds, fiat off-ramp, multi-chain.

## 2. Constraints
- Solo builder, ~7 days. Chain: Tempo (Moderato testnet, chain id 42431). Token: any TIP-20 (pathUSD on testnet).
- No accounts or API keys: public RPC, public faucet RPC (`tempo_fundAddress`), organizer's own fee-payer key (Tempo native fee sponsorship).
- Domain code knows nothing about viem, HTTP or files.

## 3. Ubiquitous language (code identifiers)
| Term | Meaning | Identifier |
|---|---|---|
| Program | a prize/bounty/grant program that pays winners | `Program` |
| Award | one amount owed to one winner, with a reference (e.g. "WF-2026-TEMPO-03") | `Award` |
| Payout batch | the awards an organizer funds together | `PayoutBatch` |
| Claim key | a one-time key inside the claim link; its address is stored on-chain; it signs "pay this recipient" | `ClaimKey` |
| Claim link | URL carrying the claim key in the fragment (never sent to a server) | `ClaimLink` |
| Paperwork | what the organizer must collect before paying (tax form, identity check, prize acceptance) | `Paperwork` |
| Clearance | the organizer's on-chain statement that an award's paperwork is complete (hash of the paperwork record) | `clear()` / `Cleared` |
| Memo | 32-byte reference attached to the TIP-20 transfer, derived from the award reference | `awardMemo()` |
| Claim | the winner's request to be paid to their recipient address | `claim()` |
| Reclaim | organizer takes back an unclaimed award after expiry | `reclaim()` |
| Award status | Funded → Cleared → Claimed, or Funded/Cleared → Expired → Reclaimed | `AwardStatus` |
| Receipt | proof of receipt for the winner's own records | `Receipt` |

## 4. Domain model
- `Award { ref, amount (base units), decimals, token, expiresAt, memo, claimSigner }`
- `AwardStatus` state machine: `Funded --clear--> Cleared --claim--> Claimed`; `Funded|Cleared --(now ≥ expiresAt)--> Expired --reclaim--> Reclaimed`. Claim on Funded → `NotCleared`; claim twice → `AlreadySettled`; claim after expiry → `Expired`.
- `Receipt { award ref, amount, token symbol, txHash, blockTime, memo, local: { currency, rate, rateDate, source, amount } }`.

## 5. Use cases (application)
- UC-1 CreateBatch: winners list (ref, amount, label) → awards with fresh claim keys, memos and claim links.
- UC-2 FundBatch: approve + `fund()` each award on the escrow.
- UC-3 ClearPaperwork: organizer records a paperwork hash for an award → `clear()`.
- UC-4 ClaimAward: from a claim link + recipient address → claim signature → sponsored `claim()` tx.
- UC-5 Reclaim: after expiry, organizer → `reclaim()`.
- UC-6 BuildReceipt: tx receipt + block time + FX rate → `Receipt`.
- UC-7 Reconcile: read escrow events → status per award (the organizer's dashboard).

## 6. Acceptance criteria (Given/When/Then → tests)
- AC-1 Given an award reference, when the memo is derived, then it is 32 bytes, deterministic, and the reference is recoverable when ≤ 31 ASCII chars (else keccak).
- AC-2 Given a claim link, when parsed, then the claim key and escrow/award id round-trip; a tampered link is rejected.
- AC-3 Given a funded but not cleared award, when claimed, then the escrow reverts `NotCleared` (contract test + Moderato).
- AC-4 Given a cleared award, when claimed with a valid claim-key signature for recipient R, then R receives the amount through `transferWithMemo` with the award memo, and `Claimed` is emitted.
- AC-5 Given a claimed award, when claimed again, then it reverts `AlreadySettled`.
- AC-6 Given a signature for recipient R, when someone submits it for recipient X, then it reverts `BadClaimSignature` (front-running safe).
- AC-7 Given an expired award, when claimed, then `Expired`; when the organizer reclaims, the organizer gets the amount back with the memo; a non-organizer cannot reclaim or clear.
- AC-8 Given a paid claim, when a receipt is built with an FX rate, then local amount = amount × rate rounded to 2 decimals, and the rate date ≤ block date.
- AC-9 Given escrow events, when reconciled, then each award shows exactly one status consistent with the state machine.
- AC-10 Given a winner with no funds, when they claim through the web page, then the fee is paid by the organizer's fee payer (winner balance before = 0, after = amount).

## 7. Architecture (Clean)
```
src/domain/          award.ts memo.ts claimLink.ts status.ts receipt.ts   (pure)
src/application/     ports.ts createBatch.ts claimAward.ts reconcile.ts buildReceipt.ts
src/adapters/        tempoEscrow.ts (viem/tempo) · ecbRates.ts (frankfurter) · csvWinners.ts
src/infrastructure/  cli.ts · server.ts (claim page + ops page) · config.ts
contracts/           ClaimEscrow.sol (+ test/ in Foundry with a TIP-20 mock)
```
Domain and application import nothing from adapters/infrastructure (checked by a test).

## 8. Non-functional
- No secrets in the repo; testnet keys in `.env.local` (git-ignored). Claim key lives only in the URL fragment.
- English UI. Mobile first.

## 9. UI acceptance (from the Toss checklist)
1 mobile-first 390/1280 no horizontal scroll · 2 claim page = one question per screen (Create passkey → Receive) · 3 title ≥22px bold, body 15–16px · 4 section gap ≥24px, card radius ≥16px · 5 one fixed bottom CTA ≥52px · 6 receipt card starts with the big number (amount ≥28px) · 7 tx hash, memo, FX source in `<details>` · 8 short friendly copy, crypto words explained in one line ("passkey = your fingerprint/face unlock") · 9 white + one blue (#3182F6) + ok/warn/no colors, contrast ≥4.5 · 10 no external fonts/CDN.

## 10. Physical verification plan
`npm run e2e:moderato`: deploy escrow → fund 4 awards → claim before clearance (refused) → clear → claim (paid, sponsored) → claim again (refused) → let one expire → reclaim. Writes `docs/live/moderato-<timestamp>.json` with tx hashes and explorer links. Web: Playwright with a virtual WebAuthn authenticator claims through the page and captures 390/1280 screenshots.

## 11. Change log
- v0.1 2026-10-04 — first spec (idea chosen by blind review: claim-link payouts for prize programs, Tempo track).
