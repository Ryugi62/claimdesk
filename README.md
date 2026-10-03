<p align="center"><img src="docs/logo.png" width="72" alt=""></p>

# Claimdesk — pay every winner by link

**Hackathons, bounty boards and grant programs lock each award on Tempo when they announce it. The winner opens one link and touches their fingerprint — that passkey becomes their account. When the organizer approves the paperwork *for that account*, the same transaction pays it. No wallet-address emails, no gas, no 60-day wait.**

Crypto World's Fair Hackathon (Colosseum, Fall 2026) · **Tempo track** · solo founder, university student · all code written during the hackathon (`git log`).

## The problem, in the operators' own words
> "The prize fulfillment process can take up to 60 days from receipt of paperwork." … "make sure that your PayPal/Payoneer/Wise account is fully set up, that it can receive international transfers … If your prize is undeliverable, you may incur fees … or be delaying or forfeiting receipt of the prize." — Devpost Help Center, *How to Claim Your Hackathon Cash Prize* (updated 2026-08-21)
>
> "A lead from Superteam will reach out to the winners with a payment form. Fill in that form and expect to receive the reward within 7 days of submitting the form. Note that the winner needs to complete KYC" — Superteam Earn FAQ (read 2026-10-04)
>
> "Each winning team may be required to set up a wallet address, as directed by Administrator." — this hackathon's Official Rules §15(b); §13 adds "Prize Acceptance Documents" and "due diligence".

Every program that pays strangers runs the same loop by hand: a payment form, a tax form and an identity check, then a payout address or a PayPal/Payoneer/Wise account that must already accept USD, then the payment, then reconciliation. The address and the paperwork travel separately, so nothing proves the person who was checked owns the account that gets paid.

I'm on the receiving end. I'm a solo builder and engineering student in South Korea who sells software abroad and has entered about a dozen global hackathons since August. Each has its own payout rules — Devpost's prize desk, Superteam's payment form, this hackathon's wallet clause — and my own payout route home has a $100 minimum before anything moves.

## How it works
```
organizer                                   escrow on Tempo                                   winner
winners.csv ─► fund N awards (1 tx) ──────► Funded       id = award ref = 32-byte transfer memo
mail-merge the links ─────────────────────────────────────────────────────────────────────────► opens link once
                                            Registered   ◄─ register(me): link key signs, passkey account sends,
                                                            organizer's relay pays the fee. Write-once.
paperwork names an address ─► clear(award, recordHash, expected = THAT address [, withholding])
                                            Claimed      ─► TIP-20 transferWithMemo to that account, same tx
                                                            receipt (local currency) · account page · send on
```
- **Paperwork is bound to the account that gets paid.** After registering, the winner fills the paperwork step and **signs it with the same passkey** (here a stand-in form; in production the organizer's KYC/W-8BEN provider) — the relay checks that signature with Tempo's signature-verifier precompile, so nobody can file paperwork for an account they don't control. The console only clears for an account with signed paperwork, the escrow's `clear()` must name that account, and a forwarded link that registered first shows up as a mismatch (the escrow would revert `RecipientMismatch`). Registration is write-once; only the registered account itself can move it (`changeRecipient`, sponsored).
- **What the organizer can and cannot do.** Funds are locked from announcement day with an on-chain expiry floor (`minTtl`, 14 days by default). Before clearance it can revoke (e.g. failed due diligence); wiping a winner's registration with a new link needs a public notice period first (`reissueDelay`, 48 h by default), shown on the winner's page. A bearer clearance always leaves a full claim window. After clearance it can no longer revoke, reissue or redirect.
- **Withholding at source, in the same transaction.** The tax account and the maximum rate are fixed when the escrow is deployed (so withholding can't become a redirect); `clear()` passes the amount, both legs carry the award memo, and the receipt shows gross, withheld and net.
- **Winner pays nothing and installs nothing.** The WebAuthn passkey *is* the Tempo account. The relay answers only the methods a sponsored send needs, and co-signs fees only for one `register`/`claim` call into its own escrow with mandatory gas and fee caps and a pinned fee token, after simulating it; only calls that would succeed count against per-award limits, so junk can't exhaust a winner's quota. It reads only `.env.relay` (the fee-payer key and the escrow), never the organizer key, and refuses transactions that stay valid for more than 3 minutes.
- **The money doesn't dead-end.** The account page (passkey sign-in, or recovery on a new browser from two signatures) sends to any wallet or exchange deposit address with a memo/tag, paying the fee in the stablecoin itself. Kraken has supported USDT0 deposits on Tempo since 2026-06-01 ([Kraken blog](https://blog.kraken.com/product/new-features/usdt0-deposits-and-withdrawals-on-tempo)). For large awards the page recommends moving to a wallet the winner already uses.
- **Auditable paperwork.** The organizer's note stays on the organizer's machine (append-only, owner-only); only a salted hash goes on-chain, and `verify` re-derives it.
- **Reconciliation for free.** Every transfer carries the award ref as its memo; the organizer console is rebuilt from escrow events, not a database.

## Why Tempo
Each piece is a protocol feature on Tempo: TIP-20 transfer memos, native fee sponsorship (a fee-payer signature on the transaction — no paymaster, bundler or EntryPoint), WebAuthn passkey accounts, batched calls (fund or clear many awards in one transaction), and stablecoin fee tokens. Next: TIP-403 receive policies as a second compliance layer, and access keys so the organizer key can stay cold.

## Proof — Tempo Moderato testnet (chain 42431)
All mined. Refusals are real reverted transactions, not simulations.

**Contract paths** — test escrow [`0xe015242a…`](https://explore.testnet.tempo.xyz/address/0xe015242a566e4ba6cd706ffb8fb514dfe0c97b49) deployed with short timers so every path runs inside one script (expiry floor 60 s, reissue notice 20 s, withholding cap 30%); production defaults are 14 days and 48 hours.

| What | Transaction |
|---|---|
| 6 awards funded in one batched transaction (≈566k gas per award, 2 storage slots each) | [`0x3f39309e…3da04f`](https://explore.testnet.tempo.xyz/tx/0x3f39309e1feb0e10ebee7397c96b76abd470f1229ab7a7ad078d680b3a3da04f) |
| A · register (fee sponsored) → clear **naming that account** → paid 0 → 25 in the clearing tx | [register](https://explore.testnet.tempo.xyz/tx/0xe691cfb622a581fd356cb0e464e107ae6ba349fb8ebb8c8563a6516caa0e42c6) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0xc750dd110a5b6a86169472efb5ffe600c25e1ba6b9edd62fa35043fa48472a19) |
| A · the same link tries to register another account → `WrongState` | [`0x1df08145…96f525`](https://explore.testnet.tempo.xyz/tx/0x1df08145db20f491294871d5c91a5ca8fbb15eec7a9aa01437865f9b8596f525) |
| F · forwarded link registered first → clear for the real winner → `RecipientMismatch` | [`0xe0ab4a36…c6de1b`](https://explore.testnet.tempo.xyz/tx/0xe0ab4a36ed2e6b275695ab9885bc980b83c616c9ce21cb7d4f71d300f6c6de1b) |
| F · new link **scheduled** (public notice, registration untouched) → after the notice period issued → old link `BadClaimSignature` → winner registers → paid; forwardee 0 | [schedule](https://explore.testnet.tempo.xyz/tx/0xe6f11f27b1b2eb943489012c916fc6f565410471bc9e2f3a5f5fd03ddaf0eb37) · [issue](https://explore.testnet.tempo.xyz/tx/0xc69c85dd1eecbc0c06c082adbd33b25f3ddeefd3fb29060344baeaa244e08aab) · [old link](https://explore.testnet.tempo.xyz/tx/0x0bc222f6c598470a28f7c11df1c47f0427dd54233d4bb69a83a6a16623021ec7) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0xaf7e4e466ae0b073470688b43bf5ea0668dbca0c9720afe9413af8f7450625a8) |
| G · withholding above the fixed 30% cap → `InvalidWithholding`; at the cap → 30 to the fixed tax account, 70 to the winner | [refused](https://explore.testnet.tempo.xyz/tx/0x3e07109dfa4aba9ca9a8276d270e1edf8202a2297384c3e0efbf6a7290da11e5) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0x1803c1c5af1c20c2e70d3a054b8f64664b6a2f797b8db9134e152e9c14091dbd) |
| B · bearer (advanced): before clearance `WrongState` → claim after clearance → twice `WrongState` | [before](https://explore.testnet.tempo.xyz/tx/0xbc598a6d7e49e4c51118385f192d2a5f3a9b6b73153b3b41cd9cbd3063d0659d) · [paid](https://explore.testnet.tempo.xyz/tx/0xcee8064ea5e3b55874ab2eb0b89a66fb4bb4f4282412beab839cc5318021a6c2) · [twice](https://explore.testnet.tempo.xyz/tx/0x382885621466867801b4f9be1dd3064a7e06c92d02015681dfd2286638fd322c) |
| E · copied claim signature, different recipient → `BadClaimSignature` | [`0x0ac8daad…7b9356`](https://explore.testnet.tempo.xyz/tx/0x0ac8daad6549e9d29d19cef02fbf7c8dd37c63863a52b776114785b9cd7b9356) |
| C · revoke before clearance (money back now) → register afterwards `WrongState` | [revoke](https://explore.testnet.tempo.xyz/tx/0x6f82f0b976d531ce8c2f4c9b5f77d08595ef5af8566011f042e185b7ba7573de) · [refused](https://explore.testnet.tempo.xyz/tx/0xe59e52c80e284f3d8a964ecbb16ce99cd120f865cd16541ee43ce63334c4c2b7) |
| D · claim after expiry `Expired` → reclaim | [refused](https://explore.testnet.tempo.xyz/tx/0x61af3e45845692573f2225d6de190df3d5404e013d37f86b3cc02bfd42ce9c55) · [reclaim](https://explore.testnet.tempo.xyz/tx/0x8f0d77b8b4b91c6242af3e2f4625b1a5de0f91867c6b00c93504842ba9281e54) |

**Browser paths** — demo escrow with the 14-day floor and a 45 s reissue notice (so the recovery fits in a run); Chromium with a virtual WebAuthn authenticator.

| What | Transaction |
|---|---|
| Passkey account registers (4.407 s) → paperwork form **signed by that passkey** → console clears from the paperwork's address → $5,000 paid (≈ 6,741,400 KRW receipt + PDF) | [register](https://explore.testnet.tempo.xyz/tx/0xc651700345b51c7dfcd2666e4ee71767f88ab0bd4f98f7c913eed2f6a340c55b) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0xa6cbdc9524f692f7414c57185c57aed100705663296a0e5874c27bb497517d31) |
| Forwarded link in the UI: winner's signed paperwork ≠ registered account → console flags it → new link scheduled → issued → real winner paid $10,000 | [schedule](https://explore.testnet.tempo.xyz/tx/0xe50cfd41363c22c6b9edbea308cef841f0a520fd18022dd59047be08a9a3d1aa) · [issue](https://explore.testnet.tempo.xyz/tx/0xb760d55c803f22af885533b06628e63513ebbc4eb6d8294a12ad6e5f800e255a) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0x3e870057ee64b02c04820e4f69c5e4a39b5a65a2ee658305134c13531615008f) |
| Passkey account sends 12.50 with an exchange deposit tag, fee paid in the stablecoin | [send](https://explore.testnet.tempo.xyz/tx/0xcca093bc4ff630d02845cda47c3c0f1aadc05c6922bd344a29b1e82e9e7934d3) |

Logs: `docs/live/moderato-2026-10-03T23-39-17-996Z.json` (contract paths) · `docs/live/web-2026-10-03T23-45-23-841Z.json` (browser). Screens: `docs/ui/`. Testnet only — faucet stablecoins, no real funds.

## Run it (no accounts, no API keys)
```bash
npm install
forge test                     # 26 unit/fuzz tests + a handler-based invariant suite (128k calls across fund/register/clear/claim/revoke/reissue/reclaim with 0 handler reverts; checks the escrow holds exactly the open awards and nothing is created or lost)
npm test                       # TypeScript tests: domain, application, adapters, relay policy, console guard, paperwork records
npm run e2e:moderato           # the whole contract story on Tempo testnet → docs/live/moderato-*.json

npm run cli -- deploy          # escrow + organizer key + separate fee-payer key (testnet faucet)
npm run cli -- batch examples/worldsfair-demo.csv --days 21   # one transaction; private links → batches/ (owner-only)
npm run relay                  # winner pages + sponsoring relay  http://localhost:5174  (fee-payer key only)
npm run console                # organizer console (organizer key, local only) — open the printed URL with its token
                               # winners: link → passkey → paperwork form (/paperwork) → paid when the console clears
node scripts/web-claim.mjs batches/<file>.links.json <REF> <OTHER_REF> "<console URL>"   # drives the passkey flows
npm run build                  # static winner pages (dist/) for any host, using Tempo's public testnet sponsor
```

## Competition
| | Pay a stranger with no wallet | Paperwork gates the payout | Paperwork bound to the paid account | Reconciliation | Time to paid |
|---|---|---|---|---|---|
| Prize desks (forms + PayPal/Payoneer/Wise) | no — needs an account that accepts USD | manual | no (separate emails) | manual | "up to 60 days" |
| Claim links (Peanut, TipLink) | yes | no | no | no | instant, ungated |
| Payout platforms (Deel, Request Finance, Payoneer) | needs onboarding | yes | yes | yes | days |
| Bounty boards' built-in payouts | wallet + payment form | manual | manual | per platform | "within 7 days" |
| **Claimdesk** | **yes — passkey** | **yes — on-chain** | **yes — register → clear(expected)** | **memo + events** | **the clearing transaction** |

Competitor columns reflect their public pages as of October 2026.

## Business
- **Wedge:** programs that already pay strangers in stablecoins and must collect paperwork first — crypto hackathons and bounty boards, then ecosystem grants (the Ethereum Foundation's Ecosystem Support Program awarded $32.6M in Q1 2025 alone — [EF blog](https://blog.ethereum.org/en/2025/05/08/allocation-q1-25)). Tempo-native programs are the first fit; others need a Tempo stablecoin they already hold.
- **Price (hypothesis to test in the pilot):** organizer pays 0.25% + $1 per settled payout; winners pay nothing. A 40-winner, $300k hackathon ≈ $790 — less than the operator time and the winner fees it replaces. Per-program pricing is the alternative we'll test.
- **Moat, honestly:** not the contract (MIT). It's the operator workflow — paperwork-provider integrations wired to `clear()`, the program-to-program distribution of a tool winners already used, and payout data that shortens every next program's paperwork.
- **Next market:** the same lock → collect account → clear → pay → reconcile loop is how platforms pay contributors and creators abroad (Payoneer moved $87.5B in 2025 at a 120 bps take rate — [FY2025 results, SEC exhibit 99.1](https://www.sec.gov/Archives/edgar/data/1845815/000110465926020081/payo-20260226xex99d1.htm)). Claimdesk starts where the recipient has no account yet.
- **Next 30 days:** one real program as a pilot (testnet, then mainnet with a token Kraken accepts on Tempo) · replace the stand-in paperwork form with a KYC/W-8BEN provider whose webhook fills the console's expected address · winner pages on one stable domain (passkeys are bound to it) · Tempo access keys so the organizer's root key stays cold.

## Architecture (spec first: [SPEC.md](SPEC.md))
```
contracts/ClaimEscrow.sol    fund · register · changeRecipient · clear(expected, withholding) · claim · reissueLink · revoke · reclaim
src/domain/                  memo · claim link · winners list · award status machine · receipt            (pure, no SDKs)
src/application/             createBatch · fundBatch · registerAccount · claimAward · statusBoard · receiptFor (ports only)
src/adapters/                Tempo escrow (batched calls, resilient RPC) · winner gateway (sponsored) · ECB rates
src/infrastructure/          relay server (fee payer only) · organizer console (organizer key, local) · relay policy · paperwork records · CLI
web/                         claim page · account page (passkey sign-in, send) · PDF receipt · console page
```
A test fails if domain or application code imports an SDK, `node:` or an adapter.

## Honest limits
- Testnet only. Claimdesk does not run KYC or give tax advice: `clear()` records the hash of the organizer's own record, and the receipt restates the ledger (its won amount is an ECB cross rate; a tax office may require its own rate).
- Before a winner registers, the link is a bearer secret, and the organizer that generated it could use it too; paperwork-sourced `clear(expected)` and `reissueLink` contain that, but a malicious organizer can always simply not pay — it is the organizer's money until clearance. The bearer path (clear with no registered account) has no binding and is an advanced, warned action.
- The paperwork form here is a stand-in (name, tax residence, signature, payout account) writing to the organizer's local inbox; it does not verify identity documents. The organizer key is a hot testnet key in `.env.local`; the console is local-only (loopback, Host allow-list, session token).
- Passkeys in the recordings come from Chromium's virtual WebAuthn authenticator (the same ceremony, no phone). A passkey is bound to the site's domain, so production needs one stable domain, and large awards should be moved to a wallet the winner already uses.
- No users yet.

## Disclosure
Built solo during the hackathon with AI coding assistants (Claude), in a focused sprint that started on 2026-10-04 — the commit history is the real history, including four contract revisions driven by security review (write-once registration, paperwork-sourced expected recipient, fixed withholding cap). No pre-existing code. MIT license.
