# Demonstration script (about 8 minutes)

Before you start: `npm run db:reset -- --yes --seed` (fresh demo data), then `npm run dev`. Keep a MySQL client and `mongosh` open in a second window.

| # | Do | Say / show |
|---|---|---|
| 1 | Open `http://localhost:3000` → redirected to sign-in. Sign in as `staff@lakeside.test` / `Demo@12345`. | Two roles; passwords are bcrypt hashes; session is an httpOnly cookie. |
| 2 | **Dashboard.** | The queue is `vw_request_queue` ordered Critical → Low then oldest first. The amber banner is a `GROUP BY … HAVING` query. Hospital table is `vw_hospital_donation_stats`. |
| 3 | **Donors** → search `mysuru`; filter "Can give today: No". | Full-text index; the 90-day rule from `fn_is_donor_eligible`. Tejas Pai donated exactly 90 days ago (eligible), Joseph Mathew 89 days ago (eligible tomorrow). |
| 4 | Register a donor with phone `12ab`. | Validation in the API and again in the database (CHECK). |
| 5 | **Recipients** → register "Demo Patient", A+. **Blood requests** → Raise a request: Demo Patient, 2 units, Critical. | The trigger forces it to start Pending with 0 units and checks hospital and group. It jumps to the top of the queue. |
| 6 | Open the request → **Matching donors**. Tick "Also show donors still in their 90-day waiting period". | `sp_match_donors`: JOIN through the Compatibility table; ranking = eligible, exact group, same city, longest wait. Point out the disclaimer. |
| 7 | Click **Record** on the first donor. | One transaction: procedure + triggers. Status → Partially Fulfilled, unit meter 1/2. |
| 8 | Click **Record** on the next donor. | Status → Fulfilled; the matching panel disappears. |
| 9 | In the MySQL client: `INSERT INTO Donation (donor_id, hospital_id, request_id, donation_date, units_donated) VALUES (1, 1, <id>, CURDATE(), 1);` | `ERROR 1644: REQUEST_ALREADY_FULFILLED` — the database itself prevents over-fulfilment, not just the app. |
| 10 | Open request #2 (O−, Sunita Devi). On **Donors**, mark Meera Nair and Manoj Kamath unavailable; reload the request. | Clear "no matching donors" state. |
| 11 | **Activity log.** | Documents in MongoDB with different `details` per action. Switch By day / By week: aggregation pipeline (`$facet`, `$group`, `$dateToString`). |
| 12 | In `mongosh`: `use blood_matcher_logs` → `db.activity_logs.find({"related.request_id": <id>}).sort({timestamp:1})` and `db.activity_logs.getIndexes()` | Second paradigm is real; show the indexes. |
| 13 | (Optional) Stop MongoDB, toggle a donor's availability, start MongoDB, press **Copy them now** on the Activity log. | Outbox: the change committed in MySQL, the log entry waited and was delivered once. |
| 14 | Sign out; sign in as `arjun@donor.test`. | Donor role: own profile only, availability toggle, requests their group can help. Click **I can help** on a request; staff at that hospital see an **Offered to help** badge in its match list. The ranking does not change, and staff still record any donation. Try `/donors` → sent back; `/api/donors` → 403. |
| 15 | Terminal: `mysql … -t < sql/08_demo_queries.sql` (or open `docs/evidence/demo_queries.txt`), then `npm test`. | Important queries, `EXPLAIN` showing index use, Q12 transaction with ROLLBACK, and the test results. |

Likely questions and where the answer is: *why two databases* → MONGODB.md §1; *what if two people record the last unit at once* → DATABASE.md §6.1 and the concurrency tests; *what if MongoDB is down* → MONGODB.md last section; *where is DROP/ALTER* → `sql/00_drop.sql`, `sql/02_migration.sql`.
