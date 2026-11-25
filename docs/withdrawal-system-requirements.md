# Islandora Withdrawal System — Required Feature

Status: required, not yet implemented. This specification is for the staging/review branch only.

## User-facing requirements

- The user must be authenticated with Firebase and have an active account.
- Minimum withdrawal request: 10,000 Coins.
- The user must have at least 5 valid referrals.
- A referral is valid only after the referred account has completed its first successful Mining Box open. Accounts created on the same device do not count as valid referrals.
- Supported payout methods: USDT, bKash, Nagad, Rocket, and Payeer.
- The user selects a payout method and supplies the destination details required for that method.
- The user submits a withdrawal request; the request does not send funds automatically.
- Every request is queued for manual Admin review and payment.
- User-visible request statuses: Pending, Approved, Rejected. A paid/completed state may be added if the Admin workflow distinguishes approval from actual payout.

## Admin workflow

- Admin can view requests with user identity, requested amount, payout method, destination details, valid-referral count, submission time, and status.
- Admin can approve or reject a pending request.
- Admin actions must be authenticated, role-authorized, and recorded in the existing admin activity audit log.
- A request must not be approved twice or processed twice.
- Rejected requests must return reserved Coins to the user's available balance exactly once.
- Approved requests must remain reserved/debited and must not be refunded automatically.
- Store an admin note/rejection reason where supported.
- Do not expose one user's payout destination details to another user.

## Accounting and abuse controls

- Withdrawal requests must be idempotent.
- Prevent concurrent requests from spending the same Coins.
- Check the 10,000 Coin minimum and 5-valid-referral rule on the server at submission time.
- Use a database transaction or equivalent atomic mechanism to reserve/debit the requested Coins and create the request/ledger record together.
- Referral eligibility must be calculated from server-side referral records, not client-submitted counts.
- Never trust a client-supplied balance, referral count, status, or admin identity.
- Do not add a withdrawal fee or payout conversion rate without an explicit product decision.

## Still to confirm before production

- Whether a user can have more than one Pending request at a time.
- Whether rejection requires a reason (recommended).
- Whether Approved means paid, or whether a separate Paid/Completed status is needed.
- Whether payout destination details should be saved for future requests.
- Whether any withdrawal fee applies (none specified so far).

## Implementation status

The current frontend has no withdrawal screen or navigation entry. The current review Worker branch has no withdrawal routes yet. Existing D1 schema is known to include `withdrawal_requests`, but its exact columns must be inspected before writing SQL against it. No production database or Worker changes are authorized by this document.
