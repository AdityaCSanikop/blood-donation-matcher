import { getPool, one, rows } from "../mysql";
import { pendingCount } from "../activity";

/** Everything the dashboard shows, read from the reporting views. */
export async function dashboard() {
  const pool = getPool();
  const [totals, queue, bloodGroups, hospitals, shortages, repeatDonors, byUrgency, pendingLogs] = await Promise.all([
    one(
      pool,
      `SELECT
         (SELECT COUNT(*) FROM Donor)                                                       AS donors_total,
         (SELECT COUNT(*) FROM vw_donor_eligibility WHERE can_donate_now = 1)                AS donors_ready,
         (SELECT COUNT(*) FROM vw_request_queue)                                             AS open_requests,
         (SELECT COUNT(*) FROM vw_request_queue WHERE urgency_level = 'Critical')            AS critical_open,
         (SELECT COALESCE(SUM(units_remaining), 0) FROM vw_request_queue)                    AS units_outstanding,
         (SELECT COALESCE(SUM(units_donated), 0) FROM Donation
           WHERE donation_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY))                      AS units_last_30_days,
         (SELECT COUNT(*) FROM Hospital)                                                     AS hospitals_total`,
    ),
    rows(pool, "SELECT * FROM vw_request_queue ORDER BY urgency_level, request_date, request_id LIMIT 8"),
    rows(pool, "SELECT * FROM vw_blood_group_overview ORDER BY FIELD(blood_group,'O-','O+','A-','A+','B-','B+','AB-','AB+')"),
    rows(pool, "SELECT * FROM vw_hospital_donation_stats ORDER BY units_collected DESC, name"),
    // GROUP BY + HAVING + correlated subquery: blood groups where the units
    // still needed exceed the donors who could give them today.
    rows(
      pool,
      `SELECT q.blood_group_needed            AS blood_group,
              COUNT(*)                        AS open_requests,
              SUM(q.units_remaining)          AS units_needed,
              MAX(q.eligible_donor_count)     AS eligible_donors,
              MIN(q.urgency_level)            AS highest_urgency
         FROM vw_request_queue q
        GROUP BY q.blood_group_needed
       HAVING SUM(q.units_remaining) > MAX(q.eligible_donor_count)
        ORDER BY highest_urgency, units_needed DESC`,
    ),
    rows(
      pool,
      `SELECT d.donor_id, d.name, d.blood_group, COUNT(*) AS donations, SUM(dn.units_donated) AS units, MAX(dn.donation_date) AS last_donation
         FROM Donation dn
         JOIN Donor d ON d.donor_id = dn.donor_id
        GROUP BY d.donor_id, d.name, d.blood_group
       HAVING COUNT(*) >= 2
        ORDER BY donations DESC, last_donation DESC
        LIMIT 5`,
    ),
    rows(
      pool,
      `SELECT urgency_level, COUNT(*) AS requests, SUM(units_remaining) AS units_remaining
         FROM vw_request_queue GROUP BY urgency_level ORDER BY urgency_level`,
    ),
    pendingCount(pool),
  ]);
  return { totals, queue, blood_groups: bloodGroups, hospitals, shortages, repeat_donors: repeatDonors, by_urgency: byUrgency, pending_activity_logs: pendingLogs };
}
