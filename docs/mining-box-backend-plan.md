# Mining Box Backend — Safe Implementation Plan

## Current verified state

- The default `main` branch and production website remain in preview mode.
- The preparation branch is separate and contains the new Worker and frontend integration for review.
- Production D1 contains `user_islands`, `user_island_boxes`, `wallet_transactions`, `referrals`, and `users` tables.
- The live production Worker still has Firebase-authenticated `POST /api/auth/sync`; the game routes on the preparation branch are not deployed.
- No production website, Worker, or D1 data has been changed by this preparation work.

## Required server-authoritative behavior

1. Verify Firebase ID token on every game API request.
2. Read and mutate Gems, box counts, island unlocks, and pending Coins only on the Worker.
3. Island 1 unlock costs 500 Gems.
4. Island 1 box prices: 10, 20, 30, 50, 100, 150, 200, 300, 500, 1000 Gems.
5. Island 1 daily rates per opened box: 2, 4, 6, 10, 20, 30, 40, 50, 100, 200 Coins.
6. Each box can be opened at most 10 times.
7. Mining accrues per island separately; Island 1 storage cap is 1,500 Coins. Excess above the cap is discarded.
8. Claim requires at least 5 pending Coins for that island.
9. Use D1 atomic batches/conditional updates and unique idempotency keys to prevent double-spend, duplicate opens, and duplicate claims.
10. A referred account becomes valid only on its first successful mining-box open. Update only an existing eligible `referrals` row; same-device referrals are rejected by the referral service before such a row is created.
11. Do not issue referral commissions until the qualifying-spend definition and commission currency are confirmed.
12. Do not alter signup bonus, login, Firebase auth, or referral registration flows.

## Proposed API contract

- `GET /api/game/state`: settle accrued mining for the authenticated user and return authoritative Gems, Coins, island unlocks, box counts, pending balances, and rates.
- `POST /api/game/island/unlock`: body `{ island_number }`; verify prerequisite and Gems, debit once, write ledger, unlock island.
- `POST /api/game/box/open`: body `{ island_number, box_number, idempotency_key }`; verify island unlock, balance, price, max count, debit Gems, increment count, write ledger, and mark an eligible referral valid on the first successful open.
- `POST /api/game/claim`: body `{ island_number, idempotency_key }`; settle mining, require >=5 pending Coins, credit Coins, clear only that island's pending amount, and write ledger.\n- `POST /api/game/exchange`: body `{ coins, idempotency_key }`; debit Coins, deduct 1% fee (rounded up), credit remaining Gems, and write both ledger entries.

## Game economy configuration

- All 10 islands require Gems to unlock. Initial unlock costs: 500, 1,000, 2,000, 4,000, 8,000, 16,000, 32,000, 64,000, 128,000, 256,000 Gems.
- Island 1 box prices/rates remain exactly as specified above.
- Initial defaults for Islands 2–10: box prices double per island; daily mining rates multiply by 1.5 per island. These are assistant-selected starting defaults and should be admin-configurable before public launch.
- Coins can be exchanged to Gems only at 1 Coin = 1 Gem, with a 1% fee. Fee is rounded up to a whole Coin; e.g. 1,000 Coins deducts 10 and credits 990 Gems.
- The exchange must never allow Gems-to-Coins conversion.

## Implementation files on this branch\n\n- `worker/review/islandora-api.game.js`: review-only Worker implementation with Firebase auth, game state, island unlock, box open, claim, and Coins-to-Gems exchange routes.\n- `worker/config/game-defaults.json`: selected economy defaults.\n- `worker/migrations/0002_game_indexes.sql`: supporting indexes only.\n\nThe default-branch frontend remains in preview mode. The preparation-branch frontend is integrated with the review API but must not be released until the backend is tested against a separate staging database and staging Worker.\n\n
## Staging environment (created 2026-11-25)

- Staging D1 database: `islandora-staging-db`
- Staging D1 database ID: `889643d9-0f60-4c04-b9f7-80cd452b8202`
- Region: APAC; read replication disabled.
- Staging Worker: `islandora-staging-api`
- Staging Worker URL: `https://islandora-staging-api.mdrakibulislam68072211.workers.dev`
- Worker deployment/version: `871364db-0b7c-4525-96c3-a605e2127219`
- The Worker version metadata confirms its only resource binding is `DB` pointing to the staging D1 database ID above. No production D1 binding or production secret was copied.
- The staging database was created from the production schema only: 11 application tables, indexes, and the one-time signup-bonus ledger trigger. No production user, wallet, withdrawal, or referral records were copied.
- A synthetic staging-only signup row was inserted to verify that the trigger grants exactly 1,000 Gems and creates a `signup_bonus` ledger record; the synthetic user and ledger row were then deleted.
- The staging Worker is deployed and enabled on workers.dev. Direct public health URL verification from the connected tool environment is blocked by its outbound-request policy, so the health endpoint still needs a browser-side check.
- Production Worker, production D1, and the default `main` branch remain unchanged.

## Current branch implementation status (review only)

The preparation branch now contains:
- A Firebase-authenticated game Worker with state, island unlock, box open, mining claim, and Coin-to-Gem exchange routes.
- A frontend integration that loads server-authoritative balances and island state after Firebase account synchronization, and sends unlock/open/claim/exchange actions to the Worker.
- An explicit unlock action for each locked island; the UI allows users to inspect locked islands while the Worker enforces the previous-island completion rule.
- A Coins-to-Gems exchange panel showing the 1% fee and server-confirmed result.
- Generated primary keys for wallet, island, and box records to match the existing D1 schema.
- Atomic conditional guards for island unlock and box opening, including the 10-open maximum and idempotency checks.
- Whole-Coin claims: only the integer portion is credited to the integer Coin balance; any fractional mining remainder stays in that island's pending storage.

## Schema and validation notes

The existing D1 schema was inspected read-only. In particular, `wallet_transactions.amount` and `users.coins` use INTEGER affinity, while `user_islands.pending_coins` is REAL. The claim path therefore preserves fractional pending Coins instead of crediting fractional values into the spendable Coin balance.

The revised SQL transaction patterns were exercised against a local SQLite in-memory database using the live table definitions. Checks covered:
- Island 1 unlock debit and ledger insertion.
- The 10-open box maximum and rejection of an 11th open without an extra Gems debit.
- Claiming 5 whole Coins from 5.75 pending Coins while preserving the 0.75 remainder.
- Exchanging 1,000 Coins into 990 Gems with a 10-Coin fee.

These are local SQL logic checks, not a Cloudflare D1 staging test. A separate staging D1 database and staging Worker are still required before production approval. The default branch and live production Worker/database have not been changed by this branch work.

## Safety / release

This branch is preparation only. No production D1 writes, Worker deployment, Pages deployment, or main-branch changes are part of this work. Test all endpoints against a separate staging database and staging Worker before requesting production approval.


## Referral integration staging gate (2026-11-25)

- The preparation-branch frontend currently has `REFERRAL_API_URL` intentionally blank. This prevents staging browser tests from accidentally calling the production Referral Worker.
- The game Worker must not mark a referral valid by directly updating `referrals`; the Referral Worker owns device eligibility and same-device rejection.
- The box-open route currently does not call a referral validation endpoint. As a result, referral validity after a successful first box open is temporarily pending until a separate staging Referral Worker and authenticated internal callback are configured.
- Before enabling referral validation in staging, create a separate staging Referral Worker bound only to `islandora-staging-db`, configure a staging-only internal secret, and test: different-device referral becomes valid after first successful box open; same-device referral remains invalid; repeated box opens do not duplicate validity or commissions.
- Do not point staging frontend or staging game Worker at the production Referral Worker. Do not deploy this review branch to production.
