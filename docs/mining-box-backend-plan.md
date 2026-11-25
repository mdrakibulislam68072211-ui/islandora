# Mining Box Backend — Safe Implementation Plan

## Current verified state

- The production frontend is still in preview mode.
- `frontend/app.js` hardcodes island unlock state, box counts, pending Coins, and storage in browser memory.
- Every Open button is rendered disabled.
- Clicking a box only displays the message that secure backend integration is pending.
- Claim is also a placeholder.
- `frontend/config.js` still has `SETTINGS.PREVIEW_MODE: true`.
- Production D1 already contains `user_islands`, `user_island_boxes`, `wallet_transactions`, `referrals`, and `users` tables.
- The main production Worker currently has Firebase-authenticated `POST /api/auth/sync`; mining routes are not yet implemented.

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
- `POST /api/game/claim`: body `{ island_number, idempotency_key }`; settle mining, require >=5 pending Coins, credit Coins, clear only that island's pending amount, and write ledger.

## Important unresolved configuration

Only Island 1 box prices/rates are explicitly specified in the current project requirements. Do not silently copy those rates to Islands 2–10. Their per-box prices/rates must be confirmed or made admin-configurable before those islands can mine.

## Safety / release

This branch is preparation only. No production D1 writes, Worker deployment, Pages deployment, or main-branch changes are part of this work. Test all endpoints against a separate staging database and staging Worker before requesting production approval.
