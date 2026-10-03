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
check paperwork for THAT address ─► clear(award, recordHash, expected = that address [, withholding])
                                            Claimed      ─► TIP-20 transferWithMemo to that account, same tx
                                                            receipt (local currency) · account page · send on
```
- **Paperwork is bound to the account that gets paid.** Registration is write-once: after it, the link has no power, and only the registered account itself can move the payout (`changeRecipient`). `clear()` must name the account the paperwork was checked for — if a forwarded link registered first, clearing reverts `RecipientMismatch` and the organizer reissues the link.
- **A commitment the winner can see.** Funds are locked from announcement day; every award has an on-chain expiry floor (`minTtl`); after clearance the organizer can no longer revoke, reissue or redirect.
- **Withholding at source, in the same transaction.** Programs that must withhold tax pass the amount and a tax account to `clear()`; both legs carry the award memo and the receipt shows gross, withheld and net.
- **Winner pays nothing and installs nothing.** The WebAuthn passkey *is* the Tempo account. The relay co-signs fees only for one `register`/`claim` call into its own escrow that simulates successfully, with gas and fee caps, a pinned fee token, per-IP and per-award limits — and it holds only a small fee-payer key, never the organizer key.
- **The money doesn't dead-end.** The account page (passkey sign-in, or recovery on a new browser from two signatures) sends to any wallet or exchange deposit address with a memo/tag, paying the fee in the stablecoin itself. Kraken has supported stablecoin deposits on Tempo since June 2026.
- **Auditable paperwork.** The organizer's note stays on the organizer's machine (append-only, owner-only); only a salted hash goes on-chain, and `verify` re-derives it.
- **Reconciliation for free.** Every transfer carries the award ref as its memo; the organizer console is rebuilt from escrow events, not a database.

## Why Tempo
Each piece is a protocol feature on Tempo: TIP-20 transfer memos, native fee sponsorship (a fee-payer signature on the transaction — no paymaster, bundler or EntryPoint), WebAuthn passkey accounts, batched calls (fund or clear many awards in one transaction), and stablecoin fee tokens. Next: TIP-403 receive policies as a second compliance layer, and access keys so the organizer key can stay cold.

## Proof — Tempo Moderato testnet (chain 42431)
All mined. Refusals are real reverted transactions, not simulations.

| What | Transaction |
|---|---|
| 6 awards funded in one batched transaction (≈566k gas per award, 2 storage slots each) | [`0xc3edd119…2f1d85`](https://explore.testnet.tempo.xyz/tx/0xc3edd1193f6aa009ae011e0e753af0aaeab98f55ff38c9cf8865860dcc2f1d85) |
| A · winner registers (fee sponsored) → organizer clears **for that account** → paid 0 → 25 in the clearing tx | [register](https://explore.testnet.tempo.xyz/tx/0xd5bd59340df1c84b6a72d923f5f22eb8f751ecd225a970524ccd224dd6d70cc7) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0xce9f8dce118c0083d94398cb39ee31277e59b27743bd2a4a201e8620dc12c4e3) |
| A · the same link tries to register another account → `WrongState` | [`0xb8eee46d…bbf070`](https://explore.testnet.tempo.xyz/tx/0xb8eee46d80f4b0683f6b154438fb811bd6bbe83d675584db79b33a337abbf070) |
| F · a forwarded link registers first → organizer's clearance names the real winner → `RecipientMismatch` | [`0xffd299df…f2d4c6`](https://explore.testnet.tempo.xyz/tx/0xffd299df93cfdacfd855d375768748a6e7048f834f136e1055c7de1199f2d4c6) |
| F · organizer reissues the link → old link `BadClaimSignature` → winner registers with the new link → paid; forwardee got 0 | [reissue](https://explore.testnet.tempo.xyz/tx/0x249a5269991bd962e73735e996e2d76702e73605cddc1c62ec567229689a327c) · [old link](https://explore.testnet.tempo.xyz/tx/0x865e3d5b949e36808829734761cfcd3d312a0bda56c91bfff97139117cce4f89) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0xcf10a4c8ac9531adfbcac4ac5fd93efc540f00eddc9cdcea008023b5f8a1aa2a) |
| G · clearance with 30% withheld → 30 to the tax account, 70 to the winner, both with the award memo | [`0xaf1256f0…6e69c7`](https://explore.testnet.tempo.xyz/tx/0xaf1256f07971788f0b5a65e4487a44f5603f912b4a3a88679eb9087f386e69c7) |
| B · bearer: before clearance `WrongState` → claim after clearance (sponsored, 1.572 s) → twice `WrongState` | [before](https://explore.testnet.tempo.xyz/tx/0xb39d0da97409ba568e719369aee0d23189b481b6e051a7823c5031b6e68f4553) · [paid](https://explore.testnet.tempo.xyz/tx/0xd99c99958385b4d63ff258bf1bee4ced9dafcb867276781ef589c0a2ff7afdff) · [twice](https://explore.testnet.tempo.xyz/tx/0xe0be6fb9c801a0c2fdc31ba9960aa9760df0f43989b5cf9a5198da58ad6f84a7) |
| E · copied claim signature, different recipient → `BadClaimSignature` | [`0xde04acbc…19235c`](https://explore.testnet.tempo.xyz/tx/0xde04acbc9572f54be25814f7c55ae2710fc60a30d6f46661e7d412510419235c) |
| C · revoke before clearance (money back now) → register afterwards `WrongState` | [revoke](https://explore.testnet.tempo.xyz/tx/0xb3871344b9e8f80b7f72cdd25c7c32fa36a406d6fcdee79e3da547e777cb7090) · [refused](https://explore.testnet.tempo.xyz/tx/0x441cfb2d5fcc5d45e195c68e541d5ca0642b7a2bfe6f20ca94ff713eeec62272) |
| D · claim after expiry `Expired` → organizer reclaims | [refused](https://explore.testnet.tempo.xyz/tx/0x59149b22e6b6c1f297e5d74a02fc82e917a90173223cc7d668d7f2d2ebcb8684) · [reclaim](https://explore.testnet.tempo.xyz/tx/0x1b3a391da8ce1946c6ab4e989858363a73d3c109331977610898acd502fb1c14) |
| Web · **passkey** account registers (3.399 s, WebAuthn signature + fee-payer signature) | [register](https://explore.testnet.tempo.xyz/tx/0xbc2906273f9d2403b044c703589f78dd2ef043b416397a2af87d878d7348b3d2) |
| Web · console clears for that address → **$15,000** test award paid; receipt ≈ 20,224,200 KRW + PDF | [clear+pay](https://explore.testnet.tempo.xyz/tx/0x8e1cbfb905add72b504505540ec106a4fb908377bc233f19e9123ee91d3d1f3d) · `docs/ui/receipt-sample.pdf` |
| Web · passkey account sends 12.50 with an exchange deposit tag, fee paid in the stablecoin | [send](https://explore.testnet.tempo.xyz/tx/0xb0abb515dc31aedb15110557e907b96ac8dcfa2cbe3d5b99b6b0937ed03bd6fd) |
| Web · passkey bearer claim of a cleared award (3.872 s end to end) | [claim](https://explore.testnet.tempo.xyz/tx/0x2f57aa4208a832e26edee575f01262603eb3dc81afa11fc6db4a0628119a68ce) |

Logs: `docs/live/moderato-2026-10-03T23-01-23-235Z.json` (contract paths) · `docs/live/web-2026-10-03T23-04-58-373Z.json` (browser; Chromium virtual WebAuthn authenticator). Screens: `docs/ui/`. Testnet only — faucet stablecoins, no real funds.

## Run it (no accounts, no API keys)
```bash
npm install
forge test                     # 22 contract tests incl. the forwarded-link front-run and a fuzzed conservation invariant
npm test                       # TypeScript tests: domain, application, adapters, relay policy, console guard, paperwork records
npm run e2e:moderato           # the whole contract story on Tempo testnet → docs/live/moderato-*.json

npm run cli -- deploy          # escrow + organizer key + separate fee-payer key (testnet faucet)
npm run cli -- batch examples/worldsfair-demo.csv --days 21   # one transaction; private links → batches/ (owner-only)
npm run relay                  # winner pages + sponsoring relay  http://localhost:5174  (fee-payer key only)
npm run console                # organizer console (organizer key, local only) — open the printed URL with its token
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
- **Wedge:** programs that already pay strangers in stablecoins and must collect paperwork first — crypto hackathons, bounty boards and ecosystem grants. Grants are the volume: the Ethereum Foundation's Ecosystem Support Program alone awarded **$32.6M in Q1 2025** (EF blog, allocation update, 2025-05-08), milestone by milestone, to teams around the world.
- **Price (plan, not yet charged):** organizer pays 0.25% + $1 per settled payout; winners pay nothing. A 40-winner, $300k hackathon ≈ $790. A grant program the size of that one quarter ≈ $82k. Three programs of that size ≈ $1M a year.
- **Next market:** the same lock → collect account → clear → pay → reconcile loop is how platforms pay contributors and creators abroad (Payoneer moved $87.5B in 2025 at a 120 bps take rate — FY2025 results, SEC exhibit 99.1). Claimdesk starts where the recipient has no account yet.
- **Next 30 days:** one real program as a pilot (testnet, then mainnet with a token Kraken accepts on Tempo) · a KYC/W-8BEN provider whose webhook calls `clear()` with the verified address · winner pages on one stable domain (passkeys are bound to it).

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
- Before a winner registers, the link is a bearer secret, and the organizer that generated it could use it too; `clear(expected)` and `reissueLink` contain that, but a malicious organizer can always simply not pay — it is the organizer's money until clearance.
- Passkeys in the recordings come from Chromium's virtual WebAuthn authenticator (the same ceremony, no phone). A passkey is bound to the site's domain, so production needs one stable domain, and large awards should be moved to a wallet the winner already uses.
- No users yet.

## Disclosure
Built solo during the hackathon with AI coding assistants (Claude). No pre-existing code. MIT license.
