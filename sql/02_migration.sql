-- ============================================================
-- 02_migration.sql  —  Evolves the Week 4 schema into the final design.
-- Demonstrates: ALTER TABLE (ADD/MODIFY COLUMN, ADD/DROP CONSTRAINT,
-- ADD/DROP FOREIGN KEY), DROP INDEX, CREATE INDEX, FULLTEXT, CREATE TABLE.
-- ============================================================

-- ---- 1. Blood_Request gets its own hospital reference -------------------
-- Week 4 reached the hospital only through Recipient. Storing it on the
-- request lets "requests handled by a hospital" be a direct FK lookup and
-- lets the database verify a donation is recorded at the right hospital.
ALTER TABLE Blood_Request
    ADD COLUMN hospital_id INT NULL AFTER recipient_id;

-- Backfill any rows that already exist (UPDATE with a JOIN).
UPDATE Blood_Request br
JOIN   Recipient r ON r.recipient_id = br.recipient_id
SET    br.hospital_id = r.hospital_id
WHERE  br.hospital_id IS NULL;

ALTER TABLE Blood_Request
    MODIFY COLUMN hospital_id INT NOT NULL,
    ADD CONSTRAINT fk_request_hospital
        FOREIGN KEY (hospital_id) REFERENCES Hospital(hospital_id)
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- 2. Fulfilment tracking --------------------------------------------
-- units_fulfilled is maintained ONLY by the Donation triggers (03_routines).
-- The CHECK is the last line of defence against over-fulfilment.
ALTER TABLE Blood_Request
    ADD COLUMN units_fulfilled INT NOT NULL DEFAULT 0 AFTER units_required,
    ADD COLUMN notes      VARCHAR(255) NULL,
    ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    MODIFY COLUMN status ENUM('Pending','Partially_Fulfilled','Fulfilled','Cancelled') NOT NULL DEFAULT 'Pending',
    ADD CONSTRAINT chk_request_fulfilled CHECK (units_fulfilled >= 0 AND units_fulfilled <= units_required),
    ADD CONSTRAINT chk_request_units_cap CHECK (units_required <= 20);

-- ---- 3. History must not silently disappear -----------------------------
-- Week 4 used ON DELETE CASCADE for donor -> donation and recipient ->
-- request. Deleting a donor would have erased donations that requests'
-- fulfilment counts depend on, so both become RESTRICT.
ALTER TABLE Donation      DROP FOREIGN KEY fk_donation_donor;
ALTER TABLE Donation
    ADD CONSTRAINT fk_donation_donor
        FOREIGN KEY (donor_id) REFERENCES Donor(donor_id)
        ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE Blood_Request DROP FOREIGN KEY fk_request_recipient;
ALTER TABLE Blood_Request
    ADD CONSTRAINT fk_request_recipient
        FOREIGN KEY (recipient_id) REFERENCES Recipient(recipient_id)
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- 4. Database-level input validation ---------------------------------
ALTER TABLE Donor
    MODIFY COLUMN city VARCHAR(50) NOT NULL,
    MODIFY COLUMN availability_status ENUM('Available','Unavailable') NOT NULL DEFAULT 'Available',
    ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD CONSTRAINT uq_donor_phone UNIQUE (phone),
    ADD CONSTRAINT chk_donor_phone CHECK (phone REGEXP '^[+]?[0-9]{7,14}$'),
    ADD CONSTRAINT chk_donor_name  CHECK (CHAR_LENGTH(TRIM(name)) >= 2);

ALTER TABLE Hospital
    ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD CONSTRAINT uq_hospital_name_city UNIQUE (name, city),
    ADD CONSTRAINT chk_hospital_phone CHECK (phone REGEXP '^[+]?[0-9]{7,14}$'),
    ADD CONSTRAINT chk_hospital_name  CHECK (CHAR_LENGTH(TRIM(name)) >= 2);

ALTER TABLE Recipient
    ADD CONSTRAINT chk_recipient_age_max CHECK (age IS NULL OR age <= 120),
    ADD CONSTRAINT chk_recipient_phone   CHECK (phone IS NULL OR phone REGEXP '^[+]?[0-9]{7,14}$'),
    ADD CONSTRAINT chk_recipient_name    CHECK (CHAR_LENGTH(TRIM(name)) >= 2);

-- Project assumption: one whole-blood donation yields 1 unit (2 allowed for
-- a double collection), so several donors may be needed for one request.
ALTER TABLE Donation
    ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD CONSTRAINT chk_donation_units_cap CHECK (units_donated <= 2);

-- ---- 5. Indexes re-designed around the real queries ---------------------
-- Matching filters on availability first, then blood group, and reads
-- last_donation_date for the 90-day rule -> covering composite index.
DROP INDEX idx_donor_bg_avail ON Donor;
CREATE INDEX idx_donor_match ON Donor(availability_status, blood_group, last_donation_date);

-- The request queue filters on status and sorts by urgency then age.
-- urgency_level is an ENUM declared Critical,High,Medium,Low, so sorting by
-- the column sorts by priority and can use this index directly.
DROP INDEX idx_request_urgency ON Blood_Request;
CREATE INDEX idx_request_queue ON Blood_Request(status, urgency_level, request_date);

-- Donation history per hospital for the statistics view.
CREATE INDEX idx_donation_hospital_date ON Donation(hospital_id, donation_date);

-- Full-text search over donor name + city for the donor search box.
ALTER TABLE Donor ADD FULLTEXT INDEX ft_donor_name_city (name, city);

-- ---- 6. Authentication (requirement: minimum 2 roles) -------------------
-- STAFF belongs to a hospital; DONOR is linked to exactly one Donor row.
CREATE TABLE App_User (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(120) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,          -- bcrypt, never plain text
    display_name  VARCHAR(100) NOT NULL,
    role          ENUM('STAFF','DONOR') NOT NULL,
    hospital_id   INT NULL,
    donor_id      INT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_email UNIQUE (email),
    CONSTRAINT uq_user_donor UNIQUE (donor_id),
    CONSTRAINT chk_user_email CHECK (email REGEXP '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
    CONSTRAINT chk_user_hash  CHECK (password_hash LIKE '$2%' AND CHAR_LENGTH(password_hash) = 60),
    CONSTRAINT chk_user_role_link CHECK (
        (role = 'STAFF' AND hospital_id IS NOT NULL AND donor_id IS NULL) OR
        (role = 'DONOR' AND donor_id    IS NOT NULL AND hospital_id IS NULL)
    ),
    -- RESTRICT (not CASCADE) on both: MySQL does not allow a column that a
    -- foreign-key action may rewrite to also appear in a CHECK constraint.
    CONSTRAINT fk_user_hospital FOREIGN KEY (hospital_id) REFERENCES Hospital(hospital_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_user_donor FOREIGN KEY (donor_id) REFERENCES Donor(donor_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- ---- 7. Outbox for MongoDB activity events ------------------------------
-- MySQL and MongoDB cannot share one transaction. Each business change
-- inserts its activity event here INSIDE the same MySQL transaction, so the
-- event exists if and only if the change committed. A relay then copies
-- pending rows to MongoDB (idempotent on event_id) and stamps delivered_at.
CREATE TABLE Activity_Outbox (
    outbox_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_id     CHAR(36) NOT NULL,
    payload      JSON NOT NULL,
    created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    delivered_at TIMESTAMP(3) NULL,
    attempts     INT NOT NULL DEFAULT 0,
    last_error   VARCHAR(255) NULL,
    CONSTRAINT uq_outbox_event UNIQUE (event_id),
    INDEX idx_outbox_pending (delivered_at, outbox_id)
) ENGINE=InnoDB;
