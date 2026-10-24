-- ============================================================
-- 04_views.sql  —  Reporting views used by the dashboard and APIs.
-- ============================================================

-- Every donor with the 90-day rule already evaluated.
CREATE OR REPLACE VIEW vw_donor_eligibility AS
SELECT d.donor_id,
       d.name,
       d.blood_group,
       d.phone,
       d.gender,
       d.dob,
       d.city,
       d.availability_status,
       d.last_donation_date,
       DATEDIFF(CURDATE(), d.last_donation_date)             AS days_since_last_donation,
       fn_is_donor_eligible(d.last_donation_date, CURDATE()) AS is_eligible,
       CASE WHEN d.last_donation_date IS NULL THEN NULL
            ELSE DATE_ADD(d.last_donation_date, INTERVAL 90 DAY) END AS next_eligible_date,
       (d.availability_status = 'Available'
        AND fn_is_donor_eligible(d.last_donation_date, CURDATE()) = 1) AS can_donate_now
FROM Donor d;

-- Open requests with everything the priority queue needs.
-- Order it with:  ORDER BY urgency_level, request_date, request_id
CREATE OR REPLACE VIEW vw_request_queue AS
SELECT br.request_id,
       br.recipient_id,
       r.name                                  AS recipient_name,
       r.blood_group                           AS recipient_blood_group,
       br.hospital_id,
       h.name                                  AS hospital_name,
       h.city                                  AS hospital_city,
       br.blood_group_needed,
       br.units_required,
       br.units_fulfilled,
       br.units_required - br.units_fulfilled  AS units_remaining,
       br.urgency_level,
       br.request_date,
       DATEDIFF(CURDATE(), br.request_date)    AS days_waiting,
       br.status,
       br.notes,
       (SELECT COUNT(*)
          FROM Donor d
          JOIN Compatibility c ON c.donor_blood_group = d.blood_group
         WHERE c.recipient_blood_group = br.blood_group_needed
           AND c.is_compatible = TRUE
           AND d.availability_status = 'Available'
           AND fn_is_donor_eligible(d.last_donation_date, CURDATE()) = 1
       )                                       AS eligible_donor_count
FROM Blood_Request br
JOIN Recipient r ON r.recipient_id = br.recipient_id
JOIN Hospital  h ON h.hospital_id  = br.hospital_id
WHERE br.status IN ('Pending', 'Partially_Fulfilled');

-- Hospital-wise donation and request statistics (aggregates + GROUP BY).
CREATE OR REPLACE VIEW vw_hospital_donation_stats AS
SELECT h.hospital_id,
       h.name,
       h.city,
       COALESCE(dn.donation_count, 0)   AS donation_count,
       COALESCE(dn.units_collected, 0)  AS units_collected,
       COALESCE(dn.distinct_donors, 0)  AS distinct_donors,
       dn.last_donation_date,
       COALESCE(rq.total_requests, 0)   AS total_requests,
       COALESCE(rq.open_requests, 0)    AS open_requests,
       COALESCE(rq.units_outstanding, 0) AS units_outstanding
FROM Hospital h
LEFT JOIN (
    SELECT hospital_id,
           COUNT(*)                 AS donation_count,
           SUM(units_donated)       AS units_collected,
           COUNT(DISTINCT donor_id) AS distinct_donors,
           MAX(donation_date)       AS last_donation_date
      FROM Donation
     GROUP BY hospital_id
) dn ON dn.hospital_id = h.hospital_id
LEFT JOIN (
    SELECT hospital_id,
           COUNT(*) AS total_requests,
           SUM(status IN ('Pending','Partially_Fulfilled')) AS open_requests,
           SUM(CASE WHEN status IN ('Pending','Partially_Fulfilled')
                    THEN units_required - units_fulfilled ELSE 0 END) AS units_outstanding
      FROM Blood_Request
     GROUP BY hospital_id
) rq ON rq.hospital_id = h.hospital_id;

-- Supply vs demand for each of the eight blood groups.
CREATE OR REPLACE VIEW vw_blood_group_overview AS
SELECT g.blood_group,
       (SELECT COUNT(*) FROM Donor d
         WHERE d.blood_group = g.blood_group)                                  AS registered_donors,
       (SELECT COUNT(*) FROM Donor d
         WHERE d.blood_group = g.blood_group
           AND d.availability_status = 'Available'
           AND fn_is_donor_eligible(d.last_donation_date, CURDATE()) = 1)      AS donors_ready_now,
       (SELECT COUNT(*) FROM Donor d
          JOIN Compatibility c ON c.donor_blood_group = d.blood_group
         WHERE c.recipient_blood_group = g.blood_group
           AND c.is_compatible = TRUE
           AND d.availability_status = 'Available'
           AND fn_is_donor_eligible(d.last_donation_date, CURDATE()) = 1)      AS compatible_donors_ready,
       (SELECT COALESCE(SUM(br.units_required - br.units_fulfilled), 0)
          FROM Blood_Request br
         WHERE br.blood_group_needed = g.blood_group
           AND br.status IN ('Pending','Partially_Fulfilled'))                 AS units_outstanding
FROM (SELECT DISTINCT recipient_blood_group AS blood_group FROM Compatibility) g;

-- Flat donation history for listings.
CREATE OR REPLACE VIEW vw_donation_history AS
SELECT dn.donation_id,
       dn.donation_date,
       dn.units_donated,
       dn.donor_id,
       d.name         AS donor_name,
       d.blood_group  AS donor_blood_group,
       dn.hospital_id,
       h.name         AS hospital_name,
       dn.request_id,
       br.blood_group_needed,
       br.urgency_level,
       r.name         AS recipient_name
FROM Donation dn
JOIN Donor    d ON d.donor_id    = dn.donor_id
JOIN Hospital h ON h.hospital_id = dn.hospital_id
LEFT JOIN Blood_Request br ON br.request_id  = dn.request_id
LEFT JOIN Recipient     r  ON r.recipient_id = br.recipient_id;
