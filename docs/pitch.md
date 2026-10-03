# Pitch video script (≤ 3:00, voice-over on slides)

Every line here is checked against `docs/live/*.json` and the README before recording.

| # | Slide | Narration |
|---|---|---|
| 1 | Rule 15(b), quoted on screen | Rule fifteen-b of this hackathon says: each winning team may be required to set up a wallet address, as directed by the administrator. Rule thirteen adds prize acceptance documents and due diligence. |
| 2 | An inbox: "Please reply with your wallet address" ×N | Behind those lines, someone at every prize program is emailing winners in dozens of countries for addresses, tax forms and signatures, then pasting forty-two-character addresses into a wallet by hand. |
| 3 | Founder: solo builder, engineering student, South Korea | I'm on the other side of that email. I'm a solo builder and engineering student in South Korea. I sell software abroad and enter global competitions, and today my money comes home through Paddle, then Payoneer with a hundred-dollar minimum and no payout in won, while a second account still waits on an identity check. |
| 4 | Claimdesk: pay every winner by link | So I built Claimdesk. The organizer funds a payout batch once. Each winner gets a link. |
| 5 | Phone: award card → passkey prompt → "Received in 1.7 s" | The winner opens it, touches their fingerprint, and the money arrives. The passkey is their account. No app, no seed phrase, no gas. The organizer pays the fee. |
| 6 | "Money doesn't move until paperwork is cleared" | And the money cannot move until the organizer has cleared that winner's paperwork. That rule lives in the escrow contract, not in a spreadsheet. A link that has not been cleared pays nothing. A copied signature with a different address is refused. Unclaimed awards come back after expiry. |
| 7 | Receipt with local currency | The winner gets a receipt with the amount in their own currency at the official reference rate on the payment date, ready for their tax filing. |
| 8 | Why Tempo: memos · fee payer · passkeys | It's built on Tempo because the three things this needs are protocol features there: transfer memos for reconciliation, native fee sponsorship, and passkey accounts. |
| 9 | Proof: Moderato tx links, 11 + 21 tests | It runs on Tempo testnet today: a passkey claim of a ten-thousand-dollar test award in under two seconds, with every refusal case on-chain and thirty-two tests. |
| 10 | Market: wedge → Payoneer $87.5B, 120 bps | We start with programs that pay strangers: hackathons, bounty boards and grants. The same rail grows into cross-border payouts to contributors, a market where Payoneer alone moved eighty-seven and a half billion dollars last year at a one-point-two percent take rate. |
| 11 | Next four weeks | Next: one real program as a pilot, mainnet, and identity and tax-form providers plugged in behind the paperwork gate. Claimdesk. Pay every winner by link. |
