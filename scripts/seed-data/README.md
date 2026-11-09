# TutorPlus starter learning catalog

`learning-catalog.json` contains twelve reviewed publisher links: six calculus resources, three introductory science resources and three writing guides. Descriptions are short catalog annotations; external pages retain their publisher attribution. The three Math assessment templates contain original TutorPlus questions, five one-point questions each, and do not create or assign learner assessments.

Publisher URLs were opened and their relevant topic content checked on November 9, 2026. A broken Purdue URL was excluded before seeding. Link availability can change. The manifest itself records the verified URLs and attribution.

Run from the repository with a private environment file containing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`:

```sh
node --env-file=/path/to/private.env scripts/seed-learning-catalog.mjs --admin-user-id VERIFIED_ADMIN_UUID
node --env-file=/path/to/private.env scripts/seed-learning-catalog.mjs --admin-user-id VERIFIED_ADMIN_UUID --apply
```

The first command previews planned inserts. The second writes missing entries. Existing resource URLs and template subject/title pairs are skipped, with no overwrite, activation or version change. This supports sequential repeat runs; it is not a concurrent-import deduplication guarantee. The script checks the TutorPlus project, verifies the account and administrator role, and calls the existing audited catalog RPCs. It creates a temporary sign-in session without sending email, then signs out only that session. Keep the environment file private. Credentials and account emails are never written to output.

Live verification: [results](../../docs/evidence/sprint4/catalog-seed-verification.json). A repeated apply created zero additional resources or templates. The database contains fifteen audited writes for this seed: twelve resources and three initial template versions. No user learning history, scores, reviews or bookings were seeded.
