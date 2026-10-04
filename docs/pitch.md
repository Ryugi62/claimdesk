# Pitch video script (≤ 3:00, voice-over on slides + live screen clips)

Every number below is in `docs/live/*.json`, the README or a cited source.

| # | Slide / clip | Narration |
|---|---|---|
| 1 | Clip: award page "Account ready" → console "Clear & pay" → award page flips to "Received" | A hackathon winner opens one link and touches their fingerprint. When the organizer approves their paperwork, the money lands in that exact account, in the same transaction. This is Claimdesk. |
| 2 | Quotes: Devpost "up to 60 days" · Superteam "payment form … KYC" · Rules §15(b) | Today, the biggest hackathon platform says prize payouts can take up to sixty days after paperwork. Bounty boards send a payment form and a KYC check. This hackathon's rules ask winners to set up a wallet address. |
| 3 | Founder | I'm on the receiving side: a solo builder and engineering student in South Korea. I've entered twelve global hackathons since August, each with its own payout rules, and my own storefront's payout provider won't release anything under a hundred dollars. |
| 4 | Clip: link → "Create my account" → fingerprint → "Complete paperwork" form | The organizer locks every award on Tempo in one transaction. The winner's passkey becomes their account, registering is free, and the paperwork is filled in for that account. |
| 5 | Clip: console — paperwork names a different account → red banner, Clear blocked → "New link" | The organizer clears with the address the paperwork names, never one read from the chain. If a forwarded link registered first, the console flags it, the escrow would refuse, and a new link goes to the real winner. |
| 6 | Clip: receipt in won + PDF → account page "Send" with a deposit tag | The winner gets a receipt in their own currency, and can move the money to a wallet or an exchange that takes Tempo deposits. |
| 7 | Slide: mined refusals + Why Tempo (memos · fee payer · passkeys · signature verifier · batch calls) | The contract enforces every rule, down to checking the winner's own passkey signature on the paperwork with Tempo's signature-verifier precompile, and each refusal in my README is a real transaction on Tempo testnet. |
| 8 | Competition table | Claim links are instant but ungated. Payout platforms are gated but make winners onboard. Claimdesk pays a stranger with no wallet, only after paperwork, and only to the account that paperwork names. |
| 9 | Business | Organizers would pay a quarter percent plus a dollar per payout; winners pay nothing. I start with hackathons and bounties that already pay in stablecoins, then ecosystem grants. My edge is the operator workflow, not the contract. |
| 10 | Ask | No users yet. Next: one real program as a pilot, a KYC provider wired to the clear button, and mainnet. If you run a prize, bounty or grant program, let me pay your next winners. |
