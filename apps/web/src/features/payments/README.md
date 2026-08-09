# Payments feature (STEP_138)

Success/failure UX for checkout return (`/payments?checkout=<id>`).

- Lists active offers and starts checkout via BFF.
- Loads payment outcome for the signed-in owner of the payment.
- UI states: loading, empty, error, forbidden, success.
- Does not call Prisma or contain pricing business rules.
