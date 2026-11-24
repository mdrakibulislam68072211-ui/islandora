# Islandora — Signup Bonus Backend Preparation

Status: **preparation only — not deployable yet**

This branch is intentionally isolated from `main`. Nothing here changes the live Pages site, Cloudflare Worker, or D1 database.

## Confirmed product rule

- Every newly created Firebase account receives exactly **1,000 Gems once**.
- Multiple accounts created on the same device are allowed. Each account is eligible for its own 1,000-Gem signup bonus.
- Device identity must not be used to deny the signup bonus.
- Gems are server-authoritative. The browser must never write or increment a Gems balance.
- Repeated login, token refresh, retries, and duplicate requests must not grant the bonus again.

## Required server flow

1. Verify the Firebase ID token on the server (never trust a UID sent by the browser).
2. Obtain the Firebase UID from the verified token.
3. In one database transaction, create/locate that UID's user row, check the one-time grant record, increment the user's Gems balance by 1,000 only if no grant exists, and record the grant.
4. Return the authoritative balance to the browser.
5. Make retries safe: a repeated request for the same UID returns the existing balance and does not increment again.

## Why implementation is paused

The GitHub repository's tracked `worker/src/index.js` is only a starter placeholder (health endpoint and HTTP 501 for other routes), and `worker/migrations/0001_initial.sql` is empty. It does not describe the live Cloudflare Worker or its D1 schema.

The live Worker is known to be separate from the tracked starter source. Its actual table names, balance column, user key, and current transaction logic have not been verified from source. Guessing these names could create a second balance system, grant Gems to the wrong record, or break login/referrals.

## Next required input (from source, not from the user)

Before writing the executable migration and Worker integration, obtain the deployed Worker source and D1 schema through an authorized Cloudflare source/connector or export. Then:
- map the verified Firebase UID to the existing user row;
- use the existing Gems balance column;
- add a unique grant ledger keyed by Firebase UID (or use an existing equivalent);
- perform balance increment and grant-ledger insert atomically;
- preserve existing `/api/auth/sync` and referral routes;
- add tests for first login, repeated login, concurrent requests, and two accounts on one device.

## Deployment safety

Do not deploy this preparation branch. Do not run a migration against production. The branch is for review and source recovery only; it is not a production-ready backend change.
