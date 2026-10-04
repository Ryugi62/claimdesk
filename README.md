<p align="center"><img src="docs/logo.png" width="72" alt=""></p>

# Claimdesk — pay every winner by link

**Hackathons, bounty boards and grant programs lock each award on Tempo when they announce it. The winner opens one link and touches their fingerprint — that passkey becomes their account. When the organizer approves the paperwork *for that account*, the same transaction pays it. No wallet-address emails, no gas, no 60-day wait.**

Crypto World's Fair Hackathon (Colosseum, Fall 2026) · **Tempo track** · solo founder, university student · all code written during the hackathon (`git log`).

**Live (Tempo testnet, no sign-up):** [winner account page](https://ryugi62.github.io/claimdesk/account.html) (passkey sign-in, gas sponsored by Tempo's public testnet sponsor) · [a paid $15,000 award, as its winner sees it](https://ryugi62.github.io/claimdesk/claim.html#v1.42431.0xc7022cb5e060daca0d6235aec384b57d3919682e.WF-26-GRAND-NBZI.0x1a15ba69647d1f7ef22fa806109c93eb4b74968aac7e0d64b80ecd3e10f978c4.aa45f1a7) — read from the escrow on chain. Hosted pages are the winner side only; the organizer console runs locally (`npm run console`, see *Run it*).

## The problem, in the operators' own words
> "The prize fulfillment process can take up to 60 days from receipt of paperwork." … "make sure that your PayPal/Payoneer/Wise account is fully set up, that it can receive international transfers … If your prize is undeliverable, you may incur fees … or be delaying or forfeiting receipt of the prize." — Devpost Help Center, *How to Claim Your Hackathon Cash Prize* (updated 2026-08-21)
>
> "A lead from Superteam will reach out to the winners with a payment form. Fill in that form and expect to receive the reward within 7 days of submitting the form. Note that the winner needs to complete KYC" — Superteam Earn FAQ (read 2026-10-04)
>
> "Each winning team may be required to set up a wallet address, as directed by Administrator." — this hackathon's Official Rules §15(b); §13 adds "Prize Acceptance Documents" and "due diligence".

Every program that pays strangers runs the same loop by hand: a payment form, a tax form and an identity check, then a payout address or a PayPal/Payoneer/Wise account that must already accept USD, then the payment, then reconciliation. The address and the paperwork travel separately, so nothing proves the person who was checked owns the account that gets paid.

I'm on the receiving end. I'm a solo builder and engineering student in South Korea who runs a one-person software business and has entered twelve global hackathons since August. Each has its own payout rules — Devpost's prize desk, Superteam's payment form, this hackathon's wallet clause — and my own software storefront's payout provider won't release anything until the balance passes $100.

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
- **Paperwork is bound to the account that gets paid — on-chain.** After registering, the winner fills the paperwork step and **signs it with the same passkey** (here a stand-in form; in production the organizer's KYC/W-8BEN provider). `clear()` must name the registered account **and carry that account's own signature over the paperwork**, which the escrow checks with Tempo's signature-verifier precompile (WebAuthn, P-256 and secp256k1 alike) — otherwise `PaperworkNotSigned`. A forwarded link that registered first can't produce the real winner's signature; the console shows the mismatch (and any conflicting filings), and the organizer issues a new link. Registration is write-once; only the registered account itself can move it (`changeRecipient`, sponsored, which also cancels a pending new link).
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

**Contract paths** — test escrow [`0x077054c6…`](https://explore.testnet.tempo.xyz/address/0x077054c6dd79b341858474c7540343e9ef7f106e) deployed with short timers so every path runs inside one script (expiry floor 60 s, reissue notice 20 s, withholding cap 30%); production defaults are 14 days and 48 hours.

| What | Transaction |
|---|---|
| 6 awards funded in one batched transaction (≈525k gas per award, 2 storage slots each) | [`0xcf5142da…f3b9e3`](https://explore.testnet.tempo.xyz/tx/0xcf5142da548378b792d874262282f1fc702ed012767478fd2e11c45ae9f3b9e3) |
| A · clear with a paperwork signature from a different key → `PaperworkNotSigned` (checked on-chain by Tempo's signature-verifier precompile) | [`0x3545a704…37af54`](https://explore.testnet.tempo.xyz/tx/0x3545a704345a882375f87b44740a680dac9ef144976506f0f3bb22927337af54) |
| A · register (fee sponsored) → clear naming that account **with its own paperwork signature** → paid 0 → 25 in the clearing tx | [register](https://explore.testnet.tempo.xyz/tx/0xb3f9d099039159bc2d1c146318c2f4bf533678d4c0cf86f8d017c34a1bf47112) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0xfde1df19c4e9b48a7f5aa4297494147935b28928b3c7e17ab570ea9e87ef39d6) |
| A · the same link tries to register another account → `WrongState` | [`0xf0f5616b…9478ed`](https://explore.testnet.tempo.xyz/tx/0xf0f5616b3000941f3fef194f40d547566d65916b8c42a30b670eebdd409478ed) |
| F · forwarded link registered first → clear for the real winner → `RecipientMismatch` | [`0x1e8bc28d…04b9c8`](https://explore.testnet.tempo.xyz/tx/0x1e8bc28d904397c769313198c3062d053c8c8b469dcdefa2aef1d3c5b704b9c8) |
| F · new link scheduled (public notice) → issued after the notice → old link `BadClaimSignature` → winner registers → paid; forwardee 0 | [schedule](https://explore.testnet.tempo.xyz/tx/0x18dd66f22f7b867e840fff15aa69b638b5a864222bfbb839fec62ac7fdad8204) · [issue](https://explore.testnet.tempo.xyz/tx/0x48f86728a0956eec6a9f84efac0122ab34b0213fac782eac013d00d6353a1700) · [old link](https://explore.testnet.tempo.xyz/tx/0x599cbc7e901007eec6134cf3ab9da53fd0dd1dff2db5b77b5d34a388b743280a) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0x08860273f2f189b55bc49b43e5fe2b186a0783b6ba5fea2b12a1aa60198563d7) |
| G · withholding above the fixed 30% cap → `InvalidWithholding`; at the cap → 30 to the fixed tax account, 70 to the winner | [refused](https://explore.testnet.tempo.xyz/tx/0xf561fdb9ed5237862695956996b70c7772c54ec5ccfd85c4cd8ff561a24f294c) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0x57fda8a52d59c8dc7462719fead9e8356af295bf8543421da7e00ba4488829b9) |
| B · bearer (advanced): before clearance `WrongState` → claim after clearance → twice `WrongState` | [before](https://explore.testnet.tempo.xyz/tx/0x2901fe6a5f028f5c6e5fd2f95d4cc8f79b7df4161f9d319228a1f9322866c1a4) · [paid](https://explore.testnet.tempo.xyz/tx/0x340658db46a7b1808d60f7222e82774238c73daf7b41d3a1f17486a4da6e8c38) · [twice](https://explore.testnet.tempo.xyz/tx/0xcf3c731c847289d335c0b7c908c2ad60f5ac62c1b334ba852adebc6f8e6108cb) |
| E · copied claim signature, different recipient → `BadClaimSignature` | [`0x7b02ec75…a5fe3f`](https://explore.testnet.tempo.xyz/tx/0x7b02ec75588aa0b32291eefeb263f045676fb80a0399285207a08c1073a5fe3f) |
| C · revoke before clearance (money back now) → register afterwards `WrongState` | [revoke](https://explore.testnet.tempo.xyz/tx/0x905bd03a4f5013197822a43c4deb832f03ca25abe684f7f2bd155d9271b764dc) · [refused](https://explore.testnet.tempo.xyz/tx/0xa1aefddd7b8fa4035cf51a91a1a0e290dbfd85f0bbda0ab9e7fd80513edcbab0) |
| D · claim after expiry `Expired` → reclaim | [refused](https://explore.testnet.tempo.xyz/tx/0xaeb1bd70694c90894bd18ec2ebee01b34bc41545ddb6c5809fa518c9d522d893) · [reclaim](https://explore.testnet.tempo.xyz/tx/0x47c78dcd801488e7ab73ca16d0a77bbb1abdec266a578e669dd7884968e18b6b) |

**Browser paths** — demo escrow with the 14-day floor and a 45 s reissue notice (so the recovery fits in a run); Chromium with a virtual WebAuthn authenticator.

| What | Transaction |
|---|---|
| Passkey account registers (4.401 s) → paperwork **signed by that passkey** → console clears; the escrow verifies the **WebAuthn** signature on-chain → $5,000 paid (≈ 6,741,400 KRW receipt + PDF) | [register](https://explore.testnet.tempo.xyz/tx/0x59e1389f80bdef2f9fcb9b34cec32f8101fb77d1f59c8927048faf957e7d7a73) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0xfd998d6b59967fc516684cf96c151708c392cdc261755193ada9f22a07144d74) |
| Forwarded link in the UI: winner's signed paperwork ≠ registered account → console flags it → new link scheduled → issued → real winner paid $10,000 | [schedule](https://explore.testnet.tempo.xyz/tx/0xd092bd15d2099d3488b5d3838c1b86734a251fab5e4fec12c353d28e2ac360ef) · [issue](https://explore.testnet.tempo.xyz/tx/0xab3e409e3f706ce8e9dd147fc3de953ee11ac4df1bc90d4a973c59d029840871) · [clear+pay](https://explore.testnet.tempo.xyz/tx/0x4ff785b2f28b5264b70601f16d247cb5b116a630bafbc8489b5cb3769b46cb19) |
| Passkey account sends 12.50 with an exchange deposit tag, fee paid in the stablecoin | [send](https://explore.testnet.tempo.xyz/tx/0x3143bea32d7cde8f2da6d2dcfd4c9b02bfa063da202968dbd94e76742694497c) |

Logs: `docs/live/moderato-2026-10-04T00-06-00-730Z.json` (contract paths) · `docs/live/web-2026-10-04T00-08-18-847Z.json` (browser). Screens: `docs/ui/`. Testnet only — faucet stablecoins, no real funds.

## Run it (no accounts, no API keys)
```bash
npm install
forge test                     # 28 unit/fuzz tests + a handler-based invariant suite (128k calls across fund/register/changeRecipient/clear/claim/revoke/reissue/reclaim; the escrow always holds exactly the open awards, nothing is created or lost, a registered award only points at a real registrant)
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
