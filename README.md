# Mining Platform — Starter Repository

Architecture:
- GitHub: source control
- Cloudflare Pages: frontend hosting
- Cloudflare Workers: trusted API
- Cloudflare D1: application database
- Firebase Authentication: email/password identity
- Telegram Bot: opens the same app as a Telegram Mini App

## Important status
This is a secure project foundation, not a production-ready earning/withdrawal platform.
Do not accept real deposits, promise cash value, or enable withdrawals until the economy,
ad-network permissions, payment provider terms, and legal requirements have been reviewed.

## Project layout
- `frontend/`: browser and Telegram WebView UI
- `worker/`: API entry point and D1 schema
- `worker/migrations/0001_initial.sql`: initial schema

## Setup overview
1. Create a GitHub repository and upload this project.
2. Create a Cloudflare Pages project connected to the repository; set the build output directory to `frontend`.
3. Create a Cloudflare Worker and D1 database; apply the SQL migration.
4. Configure Worker bindings and secrets as described below.
5. Create a Firebase project and enable Email/Password Authentication.
6. Add Firebase web config to the frontend environment/config file (web config is public; restrict allowed domains in Firebase).
7. Set the Pages API base URL in `frontend/config.js`.
8. Create a Telegram bot with BotFather and configure its Mini App URL to the deployed Pages domain.

## Worker bindings
- D1 binding: `DB`
- Secret: `FIREBASE_PROJECT_ID`
- Secret: `TELEGRAM_BOT_TOKEN` (only if implementing bot-side features; never expose it in frontend)
- Variable: `ALLOWED_ORIGIN`

Firebase ID tokens must be verified by the Worker before any account-specific action.
Telegram `initData` must be validated server-side using the bot token before it can be trusted.
Do not trust user IDs, balances, reward values, spin results, referral codes, or timestamps sent by the browser.

## Before production
- Add Firebase token verification (JWT signature + issuer/audience/expiry checks).
- Add Telegram `initData` verification and account-linking rules.
- Implement server-authoritative mining accrual and idempotent claims.
- Add admin RBAC with MFA and audit logs.
- Add rate limits, abuse detection, CSRF/CORS protections, and monitoring.
- Verify all ad network formats and reward mechanics are explicitly permitted.
- Add payment-provider integration and manual approval workflow.
- Have local counsel review real-money / cash-equivalent operation in relevant countries.

## Business rules currently recorded
- 10 islands; 10 boxes per island; max 10 opens per box.
- Island 1 unlock: 500 Gems; new account signup bonus: 1,000 Gems once.
- Gems are admin-granted after signup bonus; 1,000 Gems has an internal reference value of USD 1, not a guaranteed cash redemption.
- Island 1 box prices: 10, 20, 30, 50, 100, 150, 200, 300, 500, 1,000.
- Island 1 daily rate per opening: 2, 4, 6, 10, 20, 30, 40, 50, 100, 200.
- Per-box daily rate = number of opens × that box's per-open daily rate.
- Island 1 pending storage cap: 1,500; overflow is discarded as specified by owner.
- Claim threshold: 5 units per island.
- Referral commission: 15% of qualifying spend; separate claimable referral balance; minimum claim 5.
- A valid referral must open at least one box.
- Withdrawal minimum: 10,000 Coins; methods: USDT, Bangladesh mobile banking (bKash/Nagad/Rocket), Payeer; admin approval.
- Daily spin: once per day; reward range 20–500 Coins, weighted toward smaller rewards.
- Adsterra Direct Link: daily limit requested; no Coins for clicking. Do not force redirects or represent a click as verified ad completion.
- Monetag rewarded-ad reward mechanics must only be enabled after provider confirms the web integration and server-side reward verification.
- Admin dashboard: total users and daily active users, plus control of balances, mining, islands, referrals, spin, ad settings, and withdrawals.

Some details still need owner confirmation before production: later-island prices/rates/caps; whether overflow resumes only after claim or is permanently lost (owner said excess is lost); exact qualifying spend definition; whether five-referral withdrawal gate is permanent; payout currency/conversion and fees; Payeer availability/terms; ad-network approved placements.
