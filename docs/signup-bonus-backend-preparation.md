# Islandora — Signup Bonus Backend Preparation

Status: **code prepared on an isolated review branch — not deployed**

Branch: `feature/signup-bonus-safe-prep`

This work does not change `main`, the live Pages site, the deployed Worker, or the production D1 database.

## Verified live architecture

The deployed main Worker source and D1 schema were read directly through the connected Cloudflare account. No database rows were modified.

- Main Worker: `islandora-api`
- Auth synchronization endpoint: `POST /api/auth/sync`
- Firebase project: `islandora-c1f7b`
- User primary key: `users.firebase_uid`
- Gems balance: `users.gems`
- Signup flag: `users.signup_bonus_granted`
- Ledger: `wallet_transactions`
- Ledger idempotency key: unique `wallet_transactions.idempotency_key`

The deployed Worker currently creates a user with zero Gems and does not award the signup bonus. Its existing Firebase token verification, health endpoint, and `/api/auth/sync` route have been retained in the review implementation. The referral Worker is separate and has not been changed.

## Prepared files

1. `worker/review/islandora-api.signup-bonus.js` — review copy of the deployed main Worker with the signup grant added to `/api/auth/sync`.
2. `worker/review/0001_signup_bonus_ledger_trigger.sql` — review-only SQL trigger. It creates the wallet ledger entry as part of the same user INSERT.
3. This document — implementation and verification notes.

The trigger is deliberate: it makes the user row, 1,000-Gem balance, one-time flag, and ledger entry part of one SQLite statement/transaction. The Worker uses `INSERT ... ON CONFLICT(firebase_uid) DO NOTHING`; repeat logins do not update the Gems balance or re-fire the INSERT trigger. The existing user's email synchronization and response shape remain in place.

## Product rules retained

- A genuinely new Firebase UID receives exactly 1,000 Gems once.
- Existing accounts are not granted a retroactive bonus by this code.
- Multiple accounts on one device remain allowed; each genuinely new UID qualifies for its own signup bonus.
- Device identity does not block signup bonus eligibility.
- Gems are server-authoritative; the browser must never grant Gems.
- Repeat login, token refresh, retry, and duplicate requests must not award another bonus.

## Read-only production observation

At the time of preparation, the live `users` table contained one user row: zero rows had `signup_bonus_granted=1`, and one row had `signup_bonus_granted=0`. This implementation intentionally leaves that existing row unchanged. The production query was SELECT-only.

## Local SQL verification

The trigger and insert behavior were exercised against a temporary local SQLite database with the same relevant table columns:

- First insert for a UID: one user row with 1,000 Gems and flag set to 1; one matching ledger row.
- Second insert for the same UID: no additional Gems and no second ledger row.
- The trigger is scoped to the newly inserted row with `signup_bonus_granted=1` and `gems=1000`.

This is a local SQL behavior check, not a live Cloudflare deployment or end-to-end Firebase test. A final staging test is still required for concurrent requests and the actual Worker runtime.

## Deployment order — not yet approved or performed

1. Back up the production D1 database and confirm rollback procedure.
2. Apply the review trigger migration to the intended D1 database.
3. Deploy the reviewed Worker source to `islandora-api`.
4. Test a genuinely new account, repeated login, a second account on the same device, existing account login, and referral flow.
5. Confirm balances and ledger entries before enabling normal user traffic.

Do not deploy this branch or apply its SQL to production until the user explicitly approves the exact changes and Cloudflare write access is authorized. No live changes have been made.
