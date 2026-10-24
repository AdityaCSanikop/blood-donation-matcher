-- ============================================================
-- 00_drop.sql  —  DESTRUCTIVE: removes every project object.
-- Only run through `npm run db:reset -- --yes` (it asks for the flag).
-- Demonstrates: DROP TRIGGER / PROCEDURE / FUNCTION / VIEW / TABLE
-- ============================================================
SET FOREIGN_KEY_CHECKS = 0;

DROP VIEW IF EXISTS vw_donor_eligibility;
DROP VIEW IF EXISTS vw_request_queue;
DROP VIEW IF EXISTS vw_hospital_donation_stats;
DROP VIEW IF EXISTS vw_blood_group_overview;
DROP VIEW IF EXISTS vw_donation_history;

DROP PROCEDURE IF EXISTS sp_record_donation;
DROP PROCEDURE IF EXISTS sp_match_donors;
DROP FUNCTION  IF EXISTS fn_is_donor_eligible;
DROP FUNCTION  IF EXISTS fn_request_status;

DROP TABLE IF EXISTS Activity_Outbox;
DROP TABLE IF EXISTS App_User;
DROP TABLE IF EXISTS Donation;
DROP TABLE IF EXISTS Blood_Request;
DROP TABLE IF EXISTS Recipient;
DROP TABLE IF EXISTS Donor;
DROP TABLE IF EXISTS Hospital;
DROP TABLE IF EXISTS Compatibility;

SET FOREIGN_KEY_CHECKS = 1;
