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

I'm on the receiving end. I'm a solo builder and engineering student in South Korea who sells software abroad and has entered about a dozen global hackathons since August. Each has its own payout rules — Devpost's prize desk, Superteam's payment form, this hackathon's wallet clause — and my own Payoneer route has a $100 minimum and no payout in won.

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
- **Paperwork is bound to the account that gets paid.** After registering, the winner's page opens the paperwork step for that account (here a stand-in form; in production the organizer's KYC/W-8BEN provider). The organizer console takes the expected payout address **from the paperwork, never from the chain**, shows whether it matches the registered account, and `clear()` must name it — if a forwarded link registered first, the console flags the mismatch, the escrow would revert `RecipientMismatch`, and the organizer issues a new link. Registration is write-once; only the registered account itself can move it (`changeRecipient`).
- **What the organizer can and cannot do.** Funds are locked from announcement day with an on-chain expiry floor (`minTtl`, 14 days by default). Before clearance the organizer can still revoke (e.g. failed due diligence) or reissue the link — both are public events the winner's page shows. After clearance it can no longer revoke, reissue or redirect.
- **Withholding at source, in the same transaction.** The tax account and the maximum rate are fixed when the escrow is deployed (so withholding can't become a redirect); `clear()` passes the amount, both legs carry the award memo, and the receipt shows gross, withheld and net.
- **Winner pays nothing and installs nothing.** The WebAuthn passkey *is* the Tempo account. The relay answers only the methods a sponsored send needs, and co-signs fees only for one `register`/`claim` call into its own escrow with mandatory gas and fee caps and a pinned fee token, after simulating it; only calls that would succeed count against per-award limits, so junk can't exhaust a winner's quota. It holds only a small fee-payer key, never the organizer key.
- **The money doesn't dead-end.** The account page (passkey sign-in, or recovery on a new browser from two signatures) sends to any wallet or exchange deposit address with a memo/tag, paying the fee in the stablecoin itself. Kraken has supported USDT0 deposits on Tempo since 2026-06-01 ([Kraken blog](https://blog.kraken.com/product/new-features/usdt0-deposits-and-withdrawals-on-tempo)). For large awards the page recommends moving to a wallet the winner already uses.
- **Auditable paperwork.** The organizer's note stays on the organizer's machine (append-only, owner-only); only a salted hash goes on-chain, and `verify` re-derives it.
- **Reconciliation for free.** Every transfer carries the award ref as its memo; the organizer console is rebuilt from escrow events, not a database.

## Why Tempo
Each piece is a protocol feature on Tempo: TIP-20 transfer memos, native fee sponsorship (a fee-payer signature on the transaction — no paymaster, bundler or EntryPoint), WebAuthn passkey accounts, batched calls (fund or clear many awards in one transaction), and stablecoin fee tokens. Next: TIP-403 receive policies as a second compliance layer, and access keys so the organizer key can stay cold.

## Proof — Tempo Moderato testnet (chain 42431)
All mined. Refusals are real reverted transactions, not simulations.

| What | Transaction |
|---|---|
| 6 awards funded in one batched transaction (≈525k gas per award, 2 storage slots each) | [`0x008758a4…47d4a4`](https://explore.testnet.tempo.xyz/tx/0x008758a4ed3cf17e364f32465b64eafbcd245c0b107da873df4b2f011f47d4a4) |
| A · register (fee sponsored) → clear **naming that account** → paid 0 → 25 in the clearing tx | [register](https://explore.testnet.tempo.xyz/tx/0xcf6a3fc72792c467fa45fb5617a7fe48c697609f2d397fccf2c412ea017017d9) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0xf82ec4b0556e97727b32871023e33b342a1d8c5838048ed0fe651ad0ca9830de) |
| A · the same link tries to register another account → `WrongState` | [`0xdef52c86…91b073`](https://explore.testnet.tempo.xyz/tx/0xdef52c864a1e5046bae78e213075803582faed71de13e2e7aa07a4966491b073) |
| F · forwarded link registered first → clear for the real winner → `RecipientMismatch` | [`0x4051c6a1…70484f`](https://explore.testnet.tempo.xyz/tx/0x4051c6a18503ce3a515ba658d6822b5774d7da2708d2024272d661417d70484f) |
| F · new link issued → old link `BadClaimSignature` → winner registers with the new link → paid; forwardee 0 | [reissue](https://explore.testnet.tempo.xyz/tx/0xb72c53b893949a884d14db472ea10253052bb18370a8d2e3cce41dba5a8748ad) · [old link](https://explore.testnet.tempo.xyz/tx/0xb0f5eba813a4c635f1e127063732db65925c02d14572939f3119bf9ea5602ee7) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0x5b250362141c511d463bd201078ef7cacead6a261372a3a5f116db48a161988d) |
| G · withholding above the escrow's fixed 30% cap → `InvalidWithholding`; at the cap → 30 to the fixed tax account, 70 to the winner | [refused](https://explore.testnet.tempo.xyz/tx/0xc19b243996497e64c8ffd927e400eeedda229af08c70b0abd361890038b6c791) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0xac27abf7fc680ba38757b68f3bfb5b20f62f7c9db9535dc04396831b29df64c5) |
| B · bearer (advanced): before clearance `WrongState` → claim after clearance (1.78 s) → twice `WrongState` | [before](https://explore.testnet.tempo.xyz/tx/0x55c81f429ad1d55c745bdc02b92a0356b95c0bed62e51edb1c5ec594d137b836) · [paid](https://explore.testnet.tempo.xyz/tx/0x9c02fdad148ee28eab33281e72d15a937d55ff10f3c7fef3faa591e37bb0603c) · [twice](https://explore.testnet.tempo.xyz/tx/0x8a69054978cbdb09a192e04db03f20671e3df2a5fafa28a4b042daf817248663) |
| E · copied claim signature, different recipient → `BadClaimSignature` | [`0x1a5779ec…6865c8`](https://explore.testnet.tempo.xyz/tx/0x1a5779ece3630ee09ecff2967fd6655eed69dcb0c0f6fb37adec73ef406865c8) |
| C · revoke before clearance (money back now) → register afterwards `WrongState` | [revoke](https://explore.testnet.tempo.xyz/tx/0x52f213db99fc5208f6b726823cb99f3b89b505e6334a7068c5d2e2b28267e732) · [refused](https://explore.testnet.tempo.xyz/tx/0x839364daeea3c507bbe68f8d1451bcbaecde2883f84c1d8c8803a6e333d886e7) |
| D · claim after expiry `Expired` → reclaim (test escrow with a 60 s floor) | [refused](https://explore.testnet.tempo.xyz/tx/0x16d9b521b1945229b9110767742f261f1a708854c96277cad796c5d8635575cd) · [reclaim](https://explore.testnet.tempo.xyz/tx/0xb1f09315a023c05d75adb8bfe023f73a5153768587574b77c232facd3bcf8f36) |
| Web · passkey account registers (3.883 s) → paperwork form → console clears from the paperwork's address → $5,000 paid (≈ 6,741,400 KRW receipt + PDF) | [register](https://explore.testnet.tempo.xyz/tx/0x930981682d48f0965d469d0012671f041dbafb3e2759625bfa055c81c355b458) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0x82ec89544d2d8a1e0bcab19f4d97f4afe8df3d0c83a5f4d364d428e852e0d370) |
| Web · forwarded link in the UI: console flags the mismatch → new link → the real winner's passkey account paid $10,000 | [reissue](https://explore.testnet.tempo.xyz/tx/0x13ae58bd0d607beb7352f5d2155059958882da956acd90c5a7d9dc096d6478b6) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0x0e62d4b419eb74948fc4291e19c819c61a534178c611067657ee27a8e60633e6) |
| Web · passkey account sends 12.50 with an exchange deposit tag, fee paid in the stablecoin | [send](https://explore.testnet.tempo.xyz/tx/0x7f9cd9eb5773a25d1526d7cdedc8d8afe19035c0eede2ae16b8914c33e0876e4) |

Logs: `docs/live/moderato-2026-10-03T23-16-33-741Z.json` (contract paths) · `docs/live/web-2026-10-03T23-21-07-042Z.json` (browser; Chromium virtual WebAuthn authenticator). Screens: `docs/ui/`. Testnet only — faucet stablecoins, no real funds.

## Run it (no accounts, no API keys)
```bash
npm install
forge test                     # 24 unit/fuzz tests + a handler-based invariant suite (128k random calls: escrow holds exactly the open awards; nothing created or lost)
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
