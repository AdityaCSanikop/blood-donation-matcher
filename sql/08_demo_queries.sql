-- ============================================================
-- 08_demo_queries.sql  —  The important queries, runnable on the demo data.
--   mysql -u <user> -p blood_matcher -t < sql/08_demo_queries.sql
-- Each one is used by the application (file noted) or demonstrates a
-- required SQL feature. Output captured in docs/evidence/demo_queries.txt
-- ============================================================

-- Q1  Priority queue of open requests (VIEW + ORDER BY on the ENUM order).
--     Used by: src/lib/services/requests.ts, dashboard.
SELECT request_id, urgency_level, blood_group_needed AS needs, recipient_name, hospital_name,
       units_remaining, days_waiting, eligible_donor_count
  FROM vw_request_queue
 ORDER BY urgency_level, request_date, request_id;

-- Q2  Compatible, available, eligible donors for request 1 (STORED PROCEDURE;
--     4-table JOIN through the Compatibility lookup). Used by: matchDonors().
CALL sp_match_donors(1, 1);

-- Q3  Same request, including donors still inside the 90-day interval.
CALL sp_match_donors(1, 0);

-- Q4  The same match written as a plain query with a SUBQUERY instead of the
--     procedure (IN + correlated lookup), to show what the procedure does.
SELECT d.donor_id, d.name, d.blood_group, d.city, d.last_donation_date
  FROM Donor d
 WHERE d.availability_status = 'Available'
   AND d.blood_group IN (SELECT c.donor_blood_group
                           FROM Compatibility c
                          WHERE c.is_compatible = TRUE
                            AND c.recipient_blood_group = (SELECT blood_group_needed
                                                             FROM Blood_Request
                                                            WHERE request_id = 1))
   AND fn_is_donor_eligible(d.last_donation_date, CURDATE()) = 1
 ORDER BY d.donor_id;

-- Q5  Donor eligibility under the 90-day rule (VIEW + stored FUNCTION).
SELECT donor_id, name, blood_group, availability_status, last_donation_date,
       days_since_last_donation, is_eligible, next_eligible_date, can_donate_now
  FROM vw_donor_eligibility
 ORDER BY can_donate_now DESC, donor_id
 LIMIT 12;

-- Q6  Hospital-wise donation statistics (LEFT JOIN + GROUP BY + aggregates).
SELECT name, city, donation_count, units_collected, distinct_donors,
       open_requests, units_outstanding
  FROM vw_hospital_donation_stats
 ORDER BY units_collected DESC, name;

-- Q7  Shortage alert: blood groups where the units still needed exceed the
--     donors who could give today (GROUP BY + HAVING + aggregates).
SELECT q.blood_group_needed AS blood_group,
       COUNT(*)                    AS open_requests,
       SUM(q.units_remaining)      AS units_needed,
       MAX(q.eligible_donor_count) AS eligible_donors
  FROM vw_request_queue q
 GROUP BY q.blood_group_needed
HAVING SUM(q.units_remaining) > MAX(q.eligible_donor_count);

-- Q8  Donations per blood group and month (JOIN + GROUP BY + ORDER BY).
SELECT DATE_FORMAT(dn.donation_date, '%Y-%m') AS month, d.blood_group,
       COUNT(*) AS donations, SUM(dn.units_donated) AS units
  FROM Donation dn
  JOIN Donor d ON d.donor_id = dn.donor_id
 GROUP BY month, d.blood_group
 ORDER BY month DESC, units DESC, d.blood_group;

-- Q9  Supply versus demand for all eight groups (VIEW built on subqueries).
SELECT * FROM vw_blood_group_overview;

-- Q10 Full-text search over donor name and city (FULLTEXT index).
SELECT donor_id, name, city,
       MATCH(name, city) AGAINST ('+mysuru*' IN BOOLEAN MODE) AS relevance
  FROM Donor
 WHERE MATCH(name, city) AGAINST ('+mysuru*' IN BOOLEAN MODE);

-- Q11 Index usage: the matching filter and the queue both use their
--     composite indexes (see the `key` column).
EXPLAIN SELECT donor_id, last_donation_date FROM Donor
         WHERE availability_status = 'Available' AND blood_group IN ('O-', 'B-');
EXPLAIN SELECT request_id FROM Blood_Request
         WHERE status = 'Pending' ORDER BY urgency_level, request_date;

-- Q12 TRANSACTION + trigger effects, then ROLLBACK so the demo data is unchanged.
--     Request 2 needs 3 units of O-; donor 19 (O-, never donated) gives 1.
START TRANSACTION;
SELECT request_id, units_required, units_fulfilled, status FROM Blood_Request WHERE request_id = 2;
CALL sp_record_donation(19, 1, 2, CURDATE(), 1, @new_donation);
SELECT @new_donation IS NOT NULL AS donation_inserted;
SELECT request_id, units_required, units_fulfilled, status FROM Blood_Request WHERE request_id = 2;   -- trigger: 1 unit, Partially_Fulfilled
SELECT donor_id, last_donation_date = CURDATE() AS last_donation_is_today FROM Donor WHERE donor_id = 19;  -- trigger
ROLLBACK;
SELECT request_id, units_required, units_fulfilled, status FROM Blood_Request WHERE request_id = 2;   -- back to 0, Pending
