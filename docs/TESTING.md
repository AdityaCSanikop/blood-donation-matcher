# Testing

All tests run against **real databases**: MySQL `blood_matcher_test` and MongoDB `blood_matcher_logs_test`. Nothing is mocked and SQLite is not used anywhere. The application code under test connects with the least-privilege account (DML + EXECUTE only).

## Results of the last full run

Run on 1 Nov 2026 on Windows 11, Node 24.19, MySQL 8.0.46, MongoDB 8.2.1. The test databases were emptied first (`node scripts/db.mjs reset --yes --env test`); the browser tests ran in a separate clone in Google Chrome. An earlier run on 11 Oct 2026 (Linux, Node 22.22, MySQL 8.0.46, MongoDB 3.6.8) passed before the donor offer tests were added.

| Suite | Command | Result | Full output |
|---|---|---|---|
| Database + services | `npm test` | **108 passed**, 0 failed (7 files) | `docs/evidence/test_db_services.txt` |
| HTTP API | `npm run test:api` | **38 passed**, 0 failed | `docs/evidence/test_api.txt` |
| Browser (Playwright, Google Chrome) | `npm run test:e2e` | **10 passed**, 0 failed | `docs/evidence/test_e2e.txt` |
| Lint, type check | `npm run lint`, `npm run typecheck` | no errors | |
| Demo queries | `mysql … < sql/08_demo_queries.sql` | all executed | `docs/evidence/demo_queries.txt` |

**Not verified:** macOS, MongoDB versions other than 3.6.8 and 8.2.1, and the GitHub Actions workflow (`docs/ci-workflow.yml`). The donor offer is tested at service level only: the permanent suites do not cover its API route or its buttons. Re-run the three suites on your own machine before the demo.

## What is covered

| Area | Where | Examples of cases |
|---|---|---|
| Schema objects | `tests/db/schema.test.ts` | 9 tables, 5 views, 4 routines, 6 triggers exist; designed indexes exist and the Week 4 ones were dropped; migration results (NOT NULL, FK delete rules) |
| Compatibility data | `tests/db/schema.test.ts` | 64 pairs, 27 compatible; every pair checked against an independent hand-written chart; O− gives to all 8, AB+ receives from all 8 |
| Constraints | `tests/db/schema.test.ts` | unknown blood group, malformed phone, blank name, duplicate phone, age 0/121, units 0/21, donation 0/3 units, missing FK parent, RESTRICT on delete, role/link CHECK, non-bcrypt password rejected |
| 90-day eligibility | `tests/db/triggers.test.ts`, `tests/services/matching.test.ts` | NULL date → eligible; 89 days → not; exactly 90 → eligible; future date → not; next eligible date |
| Triggers | `tests/db/triggers.test.ts` | new request forced to Pending/0; hospital mismatch; incompatible requested group; status cannot be set by hand; partial → full; back-dated donation; **raw INSERT cannot over-fulfil**; fulfilled/cancelled requests refuse donations; incompatible donor; donations immutable; delete reverses |
| Views | `tests/db/triggers.test.ts` | queue contains only open requests in Critical→Low then oldest-first order; eligible donor count; hospital statistics including a hospital with no donations |
| Donor matching | `tests/services/matching.test.ts` | compatible groups only; O− request → only O− donors; unavailable excluded; ineligible excluded or flagged; missing donation date; full ranking order; **no matching donors**; all compatible donors in waiting period; fewer donors than units; cancelled request; unknown request |
| Request urgency ranking | `tests/services/matching.test.ts`, `tests/db/triggers.test.ts` | list order by urgency then age; filters by status and urgency |
| Cancelled requests | `tests/services/matching.test.ts`, `tests/services/donations.test.ts` | cancel once only; cannot edit, reopen, or donate afterwards; other hospital cannot cancel |
| Partial and full fulfilment | `tests/services/donations.test.ts` | 1 of 3 → Partially_Fulfilled; then 2 more → Fulfilled; walk-in donation; lowering units_required completes a request |
| Over-fulfilment prevention | `tests/services/donations.test.ts` | 2 units for a 1-unit request → 409 and nothing changed; donation to a fulfilled request refused |
| Donor offers | `tests/services/responses.test.ts` | offer shows to the donor and in the staff match list; withdrawing; incompatible group, closed request and 90-day interval refused |
| Transaction rollback | `tests/services/donations.test.ts` | failure after the INSERT undoes the donation, the request update, the donor date and the log event |
| Concurrency | `tests/services/donations.test.ts` | 2 simultaneous donations for the last unit → exactly 1 accepted; 8 simultaneous for 3 units → exactly 3; same donor twice at once → once |
| MongoDB insertion | `tests/services/activity.test.ts` | availability change (old/new status, actor); request, donation and status-change events with different `details`; no event for a rejected operation |
| MongoDB design | `tests/services/activity.test.ts` | indexes exist; history query uses its index (no COLLSCAN); validator rejects malformed documents |
| MongoDB aggregation | `tests/services/activity.test.ts` | per-day and per-ISO-week buckets with fixed timestamps across a week boundary in IST; totals by action and entity type; empty range |
| MySQL↔MongoDB consistency | `tests/services/activity.test.ts` | one delivered outbox row per document; redelivery does not duplicate; **MongoDB down** → change commits, event queued with error recorded, later flush delivers both events in order |
| Time zone | `tests/services/timezone.test.ts` | every pooled session uses `APP_TIMEZONE`; app and fixtures agree on today's date |
| API authentication | `tests/api/api.test.ts` | wrong password and unknown email → same 401; httpOnly SameSite cookie; no hash in responses; all endpoints 401 without a session; tampered token rejected; logout; bcrypt stored |
| API authorisation | `tests/api/api.test.ts` | donor gets 403 on every staff endpoint; donor can read/update only their own record; staff cannot act for another hospital |
| API validation | `tests/api/api.test.ts` | 422 with per-field messages; malformed JSON, bad ids, unknown filters → 400; impossible and future dates; duplicate → 409; unknown ids → 404 |
| API workflow | `tests/api/api.test.ts` | recipient → donors → request → matches → donation → partial → 90-day refusal → over-fulfilment refusal → fulfilled → statistics → activity log → aggregation → delete donation reopens the request |
| Registration | `tests/api/api.test.ts` | donor self-registration creates donor + login + log entry; taken email leaves no orphan donor row; weak password; hospital with first staff login |
| End to end (browser) | `e2e/app.spec.ts` | redirect to sign-in; wrong password; dashboard queue order from the database; donor search, field errors, registration; recipient → request → matching → two donations → Fulfilled; read-only view of another hospital; cancel; no-match state; walk-in donation; activity log and statistics; donor profile, availability toggle, blocked from staff pages; donor registration; phone-sized screen without horizontal overflow |

## Problems the tests found during development

Recorded because they are useful talking points:

| Found by | Problem | Fix |
|---|---|---|
| Service tests | Trigger/constraint errors reached callers as raw MySQL errors | Data layer converts every MySQL error to an API error with status and message |
| API tests (least-privilege account) | Deleting a referenced row returned 500: MySQL sends the generic error 1217 instead of 1451 when the account cannot see the child table | Both codes are mapped to `409 IN_USE` |
| Browser tests | "Donation date cannot be in the future" just after midnight: the browser's date and the database server's date were in different time zones | Every MySQL session is set to `APP_TIMEZONE`; forms no longer send a browser-computed date by default |
| Browser tests | Dashboard overflowed sideways on a phone | Layout fix (grid children may shrink) |
| Browser testing | A slow save finishing after the search changed reloaded the old search and showed "No donors match" | `reload` in `useLoad` reads the current path when it is called |
| Screenshot review | The phone-layout test measured overflow while the dashboard was still loading | The test waits for the data first |
| Setup | MySQL refuses a CHECK on a column that a foreign key may cascade into | `App_User` foreign keys use `ON UPDATE RESTRICT` |

## Screenshots

`npm run test:e2e` regenerates them in `docs/screenshots/`:

| File | Screen |
|---|---|
| `01-sign-in.png` | Sign in |
| `02-dashboard.png` | Dashboard with urgency queue, supply/demand, hospital statistics |
| `03-donor-validation.png` | Field-level validation errors |
| `04-donors.png` | Donor list with eligibility |
| `05-requests.png` | Blood requests |
| `06-matching-donors.png` | Ranked matching donors, including the waiting-period donors |
| `07-partially-fulfilled.png`, `08-fulfilled.png` | Fulfilment progress |
| `09-no-match.png` | No matching donors |
| `10-donations.png` | Donations with a walk-in |
| `11-activity-log.png` | MongoDB activity log and weekly statistics |
| `12-hospitals.png` | Hospitals |
| `13-donor-profile.png` | Donor's own page |
| `14-dashboard-mobile.png` | Phone layout |
