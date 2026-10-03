<p align="center"><img src="docs/logo.png" width="72" alt=""></p>

# Claimdesk — pay every winner by link

**Prize, bounty and grant programs lock each award on Tempo the day they announce it. The winner opens one link and touches their fingerprint — that passkey is their account, no app, no seed phrase, no gas. When the organizer clears that winner's paperwork, the money lands in that exact account in the same transaction. Nobody emails a wallet address, and nobody waits 60 days.**

Crypto World's Fair Hackathon (Colosseum, Fall 2026) · **Tempo track** · solo founder, university student · all code written during the hackathon (first commit 2026-10-04 — `git log`).

## The problem, in the industry's own words
> "The prize fulfillment process can take up to 60 days from receipt of paperwork." … "make sure that your PayPal/Payoneer/Wise account is fully set up, that it can receive international transfers … If your prize is undeliverable, you may incur fees … or be delaying or forfeiting receipt of the prize." — Devpost Help Center, *How to Claim Your Hackathon Cash Prize* (updated 2026-08-21)
>
> "Each winning team may be required to set up a wallet address, as directed by Administrator." — this hackathon's Official Rules §15(b); §13 adds "Prize Acceptance Documents" and "due diligence".

Every program that pays strangers runs the same loop by hand: collect a tax form and identity check, then collect a payout address (or a PayPal/Payoneer/Wise account that must already exist and accept USD), then pay, then reconcile. The payout address and the paperwork arrive through different emails, so nothing ties the person who was checked to the account that gets paid.

I'm on the receiving end of that loop. I'm a solo builder and engineering student in South Korea; I sell software abroad and have entered about a dozen global hackathons since August. My own money comes home through Paddle → Payoneer ($100 minimum, no payout in KRW) → bank, and a Wise account still waits on an identity check.

## How Claimdesk works
```
organizer                               escrow on Tempo                              winner
winners.csv ─► fund N awards ─────────► Funded      (one batched transaction; id = 32-byte memo)
send links (mail-merge CSV) ─────────────────────────────────────────────────────────► opens link once
                                        Registered  ◄── register(me) signed by the link's one-time key,
                                                        sent by the new passkey account, fee sponsored
paperwork done ─► clear(award, hash) ─► Claimed     ── TIP-20 transferWithMemo ────► paid, in the same tx
                                                                                      receipt PDF (local currency)
                                                                                      account page: send to exchange
no account yet? clear opens a bearer claim → link holder receives with a passkey (fee sponsored)
failed due diligence? revoke() before clearance → money back now      unclaimed? reclaim() after expiry
```
- **The paperwork binds to the account that gets paid.** The winner registers their account through the link *before* paperwork; the organizer's identity/tax check can show that address; `clear()` pays exactly it. A forwarded link after registration can't redirect the money.
- **A visible commitment.** Funds are locked from announcement day, and once paperwork is cleared the organizer can no longer revoke.
- **Link = authority, not a server.** The claim key lives in the URL fragment (never sent to a server). Register and claim signatures are domain-separated, bound to escrow + chain + award + recipient; malleable signatures are rejected.
- **Winner pays nothing and installs nothing.** WebAuthn passkey = Tempo account. The organizer's relay co-signs fees only for one `register()`/`claim()` call into its own escrow, after simulating it, with a gas cap and per-IP rate limit, using a fee-payer key separate from the organizer key.
- **The money doesn't dead-end.** The account page signs in with the same passkey (or recovers it on a new browser from two signatures) and sends to an exchange deposit address with a memo/tag — the fee is paid in the stablecoin itself, because Tempo has no gas token.
- **Reconciliation for free.** The award reference rides as the TIP-20 memo; the organizer console is rebuilt from escrow events, not a database.

## Why Tempo
Transfer memos, native fee sponsorship (fee-payer signature on the transaction — no paymaster, bundler or EntryPoint), WebAuthn passkey accounts, batched calls and stablecoin fee tokens are protocol features on Tempo. Claimdesk is those features pointed at one job. Next: TIP-403 receive policies as a second compliance layer and virtual addresses for per-program funding.

## Proof — Tempo Moderato testnet (chain 42431)
All of these are mined transactions; refusals are real reverted transactions, not simulations.

| What | Transaction |
|---|---|
| 4 awards funded in one batched transaction (≈532k gas per award) | [`0xdbfb5377…6bc6e7`](https://explore.testnet.tempo.xyz/tx/0xdbfb5377640bc497db8fb3c680cc4cc83f9e7f8c049403138922066d806bc6e7) |
| Path A: winner registers (sponsored) → organizer clears → winner 0 → 25 paid in the clearing tx | [register](https://explore.testnet.tempo.xyz/tx/0x21d3032d4b2a062582b5c465678c4a579dc808ea1a4c3dfdf5b475ec94c40fd9) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0x72ecfd5c3562a80e75883f9aa8cce8de3acb093ee8141cab0a58c2d9ae1319bc) |
| Path B: sponsored bearer claim after clearance (0 → 15) | [`0xb5b42d74…000185`](https://explore.testnet.tempo.xyz/tx/0xb5b42d7443d5b08775775e1a10ea16934212b645008b97eb3f35ddeae4000185) |
| Refused: before paperwork `NotCleared` · twice `AlreadySettled` · copied signature to another address `BadClaimSignature` · after revoke `AlreadySettled` · after expiry `Expired` | [1](https://explore.testnet.tempo.xyz/tx/0x92b1094eaeae52755cddf1ab0751bf245b8a874ded433afaaa5649754e1567b0) · [2](https://explore.testnet.tempo.xyz/tx/0x5766a4e671d2acb8fc2bae594428998a0d54ae0dc87099a189b22af4ca23cb8e) · [3](https://explore.testnet.tempo.xyz/tx/0x7180533b62b084a3526f3528f4660d0a2a928e62ccf17e7b86654d098369191d) · [4](https://explore.testnet.tempo.xyz/tx/0x5585647c7549b755fb8b08a688d7aac158913078e5fee4d2658d396041289d84) · [5](https://explore.testnet.tempo.xyz/tx/0xe3ccf2c3c91baca6f8fe89f44232464340ea77afd3e4ff74a4a56a7266251269) |
| Revoke (money back now) · reclaim after expiry | [revoke](https://explore.testnet.tempo.xyz/tx/0x03a862fc5e1b8df3ff02e85d102be7b55ce63f5bae603551702c4149ae6cc259) · [reclaim](https://explore.testnet.tempo.xyz/tx/0x628731edf73f56fae51f4ce7f1798553c43b1b6a2a307c2834e33152e0e6cb49) |
| Web, passkey: register in 2.8 s → clear → $15,000 test award paid, receipt ≈ 20,224,200 KRW, PDF | [clear+pay](https://explore.testnet.tempo.xyz/tx/0xb41f562c823afb618509a988e855a84791d9bda8cc9637e9f741a0df10a84038) · `docs/ui/receipt-sample.pdf` |
| Web, passkey account sends 12.50 to an exchange-style address with a deposit tag, fee paid in the stablecoin | [`0xfb9c0314…05351a`](https://explore.testnet.tempo.xyz/tx/0xfb9c0314240080d6c5529a14cd84cfaf31e4c9f9e22eedee1e69f7b93c05351a) |
| Web, passkey bearer claim of a cleared award in 2.5 s | [`0x215985d5…69fd3`](https://explore.testnet.tempo.xyz/tx/0x215985d505cf59539737a202ad163ed3219f8b73eb7e7182f2497a39f4b69fd3) |

Logs: `docs/live/moderato-2026-10-03T22-37-13-930Z.json` (contract paths) · `docs/live/web-2026-10-03T22-39-42-632Z.json` (browser, Chromium virtual WebAuthn authenticator). Screens: `docs/ui/`. Testnet only — test stablecoins from the public faucet; no real funds.

## Run it (no accounts, no API keys)
```bash
npm install
forge test                      # 27 contract tests incl. a fuzzed conservation invariant (Foundry)
npm test                        # TypeScript tests: domain, application, adapters, sponsorship policy
npm run e2e:moderato            # the whole contract story on Tempo testnet → docs/live/moderato-*.json

npm run cli -- deploy           # escrow + organizer key + separate fee-payer key (testnet faucet)
npm run cli -- batch examples/worldsfair-demo.csv --days 14     # one transaction; private links → batches/
npm run serve                   # organizer console http://localhost:5174 · winner pages /claim#… /account
node scripts/web-claim.mjs batches/<file>.links.json <REF> <CLEARED_REF>   # drives the passkey flows
npm run build                   # static winner pages (dist/) for any static host, using Tempo's public testnet sponsor
```

## Competition
| | Pay a stranger with no wallet | Paperwork gates the payout | Paperwork bound to the paid account | Reconciliation | Time to paid |
|---|---|---|---|---|---|
| Devpost-style prize desk (forms + PayPal/Payoneer/Wise) | no — winner must already have an account that accepts USD | manual | no (separate emails) | manual | "up to 60 days" |
| Claim links (Peanut, TipLink) | yes | no | no | no | instant, ungated |
| Contractor/payout platforms (Deel, Request Finance, Payoneer) | needs onboarding | yes (their KYC) | yes | yes | days, recipient fees |
| Bounty boards' built-in payouts (e.g. Superteam Earn) | wallet required | manual | manual | per platform | varies |
| **Claimdesk** | **yes — passkey** | **yes — on-chain** | **yes — register before clear** | **memo + events** | **the clearing transaction** |

Competitor columns reflect their public product pages as of October 2026.

## Business
- **Wedge:** programs that pay many strangers once — hackathons, bounty boards, ecosystem grants. Colosseum alone runs two hackathons a year with dozens of winning teams (2,857 submissions from 150 countries last spring); Superteam Earn's public stats endpoint reports $15.9M in total value (read 2026-10-04).
- **Price (plan, not yet charged):** organizer pays 0.5% per settled payout, $5 minimum, $50 cap; winners pay nothing. A 40-winner, $300k program ≈ $1,500 (40 × $37.50) — less than the operator time it replaces, and the fees the winners no longer lose.
- **Where it grows:** the same flow (lock → collect account → clear → pay → reconcile) is how platforms pay contributors and creators abroad. Payoneer moved **$87.5B** in 2025 at a **120 bps** take rate (FY2025 results, SEC exhibit 99.1, 2026-02-26) — Claimdesk starts where the recipient has no account yet.
- **Next 30 days:** one real program as a pilot (testnet first, then mainnet) · plug an identity/tax-form provider behind `clear()` · hosted winner pages on a stable domain.

## Architecture (spec first: [SPEC.md](SPEC.md))
```
contracts/ClaimEscrow.sol   fund · register · clear (pays a registered account) · claim · revoke · rotateSigner · reclaim · two-step organizer
src/domain/                 memo · claim link · winners list · award status machine · receipt              (pure, no SDKs)
src/application/            createBatch · fundBatch · registerAccount · claimAward · statusBoard · receiptFor   (ports only)
src/adapters/               Tempo escrow (batched calls) · winner gateway (sponsored) · ECB rates
src/infrastructure/         organizer CLI · local server (console, winner pages, sponsoring relay) · relay policy
web/                        claim page · account page (passkey sign-in, send) · PDF receipt · organizer console
```
A test fails if domain or application code imports an SDK, `node:` or an adapter.

## Honest limits
- Testnet only. `clear()` records a hash of the organizer's paperwork record — Claimdesk does not run KYC or give tax advice; the receipt restates the ledger.
- The organizer creates the claim keys, so the organizer (or anyone holding its private links file, written owner-only) could act as the link holder. Registering early removes that power for the award; `rotateSigner` kills a leaked link.
- Passkeys in the recordings come from Chromium's virtual WebAuthn authenticator (same ceremony, no phone). A passkey is bound to the site's domain, so production needs one stable domain.
- No users yet.

## Disclosure
Built solo during the hackathon with AI coding assistants (Claude). No pre-existing code. MIT license.
