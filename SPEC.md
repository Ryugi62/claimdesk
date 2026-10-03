# Claimdesk — SPEC (SDD, v0.2 2026-10-04)

## 0. One line
Pay every winner by link: an organizer locks each award on Tempo when it announces winners; each winner opens their link once and registers a passkey account; clearing that winner's paperwork pays exactly that account in the same transaction — no gas, no seed phrase, no "send us your wallet address" email.

## 1. Success criteria (numbers) · deadline (constant) · non-goals
- Moderato testnet, measured, each with a mined transaction hash: path A (register → clear pays) · path B (bearer claim) · refusals NotCleared / AlreadySettled (twice, after revoke) / BadClaimSignature / Expired · revoke · reclaim · batch funding in one transaction.
- Winner pays 0 gas (fee sponsored) · link opened → money received ≤ 60 s · every payout carries a 32-byte memo that maps back to the award.
- Receipt shows: amount, token, tx hash, block time (UTC), memo, and the amount in the winner's local currency at the block date (ECB reference rate) with the rate's source and date.
- All tests green (contract + TypeScript) · pitch ≤ 3:00 · demo ≤ 3:00.
- Deadline: contest ends 2026-10-12 23:59 PT (= 2026-10-13 15:59 KST); internal freeze 2026-10-11 20:00 KST.
- Non-goals (v0.2): real KYC vendor, tax advice, mainnet funds, fiat off-ramp, multi-chain.

## 2. Constraints
- Solo builder, ~7 days. Chain: Tempo (Moderato testnet, chain id 42431). Token: any TIP-20 (pathUSD on testnet).
- No accounts or API keys: public RPC, public faucet RPC (`tempo_fundAddress`), a dedicated fee-payer key (Tempo native fee sponsorship) separate from the organizer key; static winner pages may use Tempo's public testnet sponsor.
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
| Registration | the link holder names the account to be paid (signed by the claim key, domain tag `claimdesk.register`) | `register()` / `Registered` |
| Clearance | the organizer's on-chain statement that an award's paperwork is complete (hash of the record); pays the registered account at once | `clear()` / `Cleared` |
| Revoke | organizer cancels before clearance; money returns now | `revoke()` / `Revoked` |
| Memo | 32-byte reference attached to the TIP-20 transfer, derived from the award reference | `awardMemo()` |
| Claim | the winner's request to be paid to their recipient address | `claim()` |
| Reclaim | organizer takes back an unclaimed award after expiry | `reclaim()` |
| Award status | Funded (→ Registered) → Cleared → Claimed; Funded → Revoked; Funded/Cleared → Expired → Reclaimed | `AwardStatus` |
| Receipt | proof of receipt for the winner's own records | `Receipt` |

## 4. Domain model
- `Award { token, amount, claimSigner, expiresAt, status, recipient }` — id = memo (32-byte reference); 2 storage slots (+1 when registered).
- State machine: `Funded --register--> Funded(recipient)`; `Funded --clear--> Claimed` if a recipient is registered, else `Cleared --claim--> Claimed`; `Funded --revoke--> Revoked`; `Funded|Cleared --(now ≥ expiresAt)--> Expired --reclaim--> Reclaimed`. Claim on Funded → `NotCleared`; any action on a settled award → `AlreadySettled`; after expiry → `Expired`; revoke after clearance → `AlreadyCleared`.
- `Receipt { award ref, amount, token symbol, txHash, blockTime, memo, local: { currency, rate, rateDate, source, amount } }`.

## 5. Use cases (application)
- UC-1 CreateBatch: winners list (ref, amount, label) → awards with fresh claim keys, memos and claim links.
- UC-2 FundBatch: approve + `fund()` each award on the escrow.
- UC-3 RegisterAccount (path A): link + the winner's account → register signature → sponsored `register()`; organizer `clear()` then pays it.
- UC-4 ClaimAward (path B): cleared award without registration → claim signature → sponsored `claim()`.
- UC-5 Revoke / Reclaim / RotateSigner (organizer).
- UC-6 BuildReceipt: tx receipt + block time + FX rate → `Receipt`.
- UC-7 Reconcile: read escrow events → status per award (the organizer's dashboard).

## 6. Acceptance criteria (Given/When/Then → tests)
- AC-1 Given an award reference of ≤ 31 printable ASCII characters, when the memo is derived, then it is 32 bytes, deterministic and reversible; longer or non-ASCII references are rejected (they must fit the memo).
- AC-2 Given a claim link, when parsed, then the claim key and escrow/award id round-trip; a tampered link is rejected.
- AC-3 Given a funded but not cleared award, when claimed, then the escrow reverts `NotCleared` (contract test + Moderato).
- AC-4 Given a cleared award, when claimed with a valid claim-key signature for recipient R, then R receives the amount through `transferWithMemo` with the award memo, and `Claimed` is emitted.
- AC-5 Given a claimed award, when claimed again, then it reverts `AlreadySettled`.
- AC-6 Given a signature for recipient R, when someone submits it for recipient X, then it reverts `BadClaimSignature` (front-running safe).
- AC-7 Given an expired award, when claimed, then `Expired`; when the organizer reclaims, the organizer gets the amount back with the memo; a non-organizer cannot reclaim or clear.
- AC-8 Given a paid claim, when a receipt is built with an FX rate, then local amount = amount × rate rounded to 2 decimals, and the rate date ≤ block date.
- AC-9 Given escrow events, when reconciled, then each award shows exactly one status consistent with the state machine.
- AC-10 Given a winner with no funds, when they register or claim through the web page, then the fee is paid by the fee payer (winner balance before = 0, after = amount).
- AC-11 Given a registered account, when the organizer clears, then that account is paid in the clearing transaction and a different recipient can never be paid.
- AC-12 Given a funded award, when revoked, then the organizer is repaid now and register/claim revert; revoke after clearance reverts `AlreadyCleared`.
- AC-13 Given a leaked link, when the organizer rotates the signer, then the old key's signatures revert.
- AC-14 Sponsorship policy: exactly one `register()`/`claim()` call into an own escrow, gas ≤ 1.2M, no key authorizations, simulation succeeds, ≤ 30 requests/min/IP.
- AC-15 Given no reference rate for the winner's currency, the receipt is shown in USD only (never an error after the money moved).

## 7. Architecture (Clean)
```
src/domain/          award.ts memo.ts claimLink.ts status.ts receipt.ts                     (pure)
src/application/     ports.ts payouts.ts                                                     (use cases, ports only)
src/adapters/        tempoEscrow.ts (viem/tempo: escrow, winner gateway, claim keys) · ecbRates.ts · claimEscrowArtifact.ts
src/infrastructure/  cli.ts · server.ts (console, winner pages, relay) · relay.ts (policy) · config.ts
web/                 claim.ts · account.ts · common.ts (passkeys) · receiptPdf.ts · ops.html
contracts/           ClaimEscrow.sol (+ test/ in Foundry with a TIP-20 mock)
```
Domain and application import nothing from adapters/infrastructure (checked by a test).

## 8. Non-functional
- No secrets in the repo; testnet keys in `.env.local` (git-ignored). Claim key lives only in the URL fragment.
- English UI. Mobile first.

## 9. UI acceptance (from the Toss checklist)
1 mobile-first 390/1280 no horizontal scroll · 2 claim page = one question per screen (Create passkey → Receive) · 3 title ≥22px bold, body 15–16px · 4 section gap ≥24px, card radius ≥16px · 5 one fixed bottom CTA ≥52px · 6 receipt card starts with the big number (amount ≥28px) · 7 tx hash, memo, FX source in `<details>` · 8 short friendly copy, crypto words explained in one line ("passkey = your fingerprint/face unlock") · 9 white + one blue (#3182F6) + ok/warn/no colors, contrast ≥4.5 · 10 no external fonts/CDN.

## 10. Physical verification plan
`npm run e2e:moderato`: deploy → batch-fund 5 awards in one transaction → path A (register → clear pays) → path B (refused before clearance, claim, refused twice) → redirected signature refused → revoke + refused after revoke → 60 s award refused after expiry + reclaim → status board → KRW receipt. Every refusal is a mined reverted transaction (fixed gas). Writes `docs/live/moderato-<ts>.json`.
`node scripts/web-claim.mjs`: Chromium with a virtual WebAuthn authenticator against `npm run serve`: register with a passkey → organizer clears via the console API → receipt + PDF → account page sends with a deposit tag → second winner bearer-claims; screenshots at 390/1280 with a horizontal-overflow check. Writes `docs/live/web-<ts>.json`.

## 11. Change log
- v0.1 2026-10-04 — first spec (idea chosen by blind review: claim-link payouts for prize programs, Tempo track).
- v0.2 2026-10-04 — after mock review round 1 (53/54/58): register-before-clear binds paperwork to the paid account; revoke, rotate, two-step organizer; batch funding; refusals mined on-chain; separate fee payer + simulated, rate-limited relay; account page (send, fee in stablecoin); PDF receipt; static build.
