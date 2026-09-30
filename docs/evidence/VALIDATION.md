# Validation record

Recorded September 30, 2026 on the local development machine. Results are observed command output, not an instructor grade, client acceptance or submission receipt.

## Executed checks

| Check | Result |
| --- | --- |
| `bash scripts/build.sh --fresh` | Passed: clean install, typecheck, lint, 87 unit tests, integration tests and production build |
| Live integration tests against local Supabase | 12 passed |
| Browser tests on the production server (desktop and phone) | 12 passed, 4 skipped, 0 failed |
| SQL regression on the live local database | 67 assertions passed |
| Standalone DDL replay on a scratch database | 68 assertions passed |
| Concurrent reservation test (two clients, same slot) | One reservation committed; the other was rejected with SQLSTATE 23P01 |

## Scope of the evidence

- User management (UC-01): registration, mailbox verification, login, logout, 24-hour non-sliding session, and role checks read from the database were exercised through a real browser and the local authentication service. Local mail capture proves verification logic only, not delivery to an external inbox.
- Profile (UC-02): own display name and time zone saved, reloaded, and denied for another account.
- Reservations (UC-04): a reservation is saved as `payment_pending` with a hold and can be cancelled. No payment is taken; Stripe is not integrated.
- Formal requirement test cases remain "TBD" in each requirement, as the lecture template allows; the checks above are separate executed verification.

## Open items

Three confirmed Group 8 client requirements, a GitHub Projects board, individual PDF submissions, and the coordinator's printed copy are external steps not completed by this workspace.
