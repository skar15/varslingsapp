# 005 Plan changes and downgrades below usage

Date: 2026-11-04 · Status: accepted — confirm with product owner

Stripe's Customer Portal cannot ask our API whether a downgrade fits current usage. Therefore:

- `POST /v1/billing/change-plan` (owner) refuses a plan whose limits are below current users + pending invitations or objects (`409 downgrade_below_usage`), then updates the Stripe subscription.
- Configure the Customer Portal **without** plan switching (invoices, payment method and cancellation only).
- If a plan change still arrives by webhook, it is applied; limits are enforced on every insert, so nothing new can be added until usage fits.
