-- ============================================================
-- 01_schema.sql  —  Baseline schema (the Week 4 submission, unchanged)
-- Blood Donation Urgency & Compatibility Matcher  |  MySQL 8.x
--
-- The database itself is created/selected by scripts/db.mjs
-- (or run:  CREATE DATABASE blood_matcher; USE blood_matcher;  first).
-- Everything added after Week 4 lives in 02_migration.sql as ALTERs,
-- so the evolution of the design is visible and reproducible.
-- ============================================================

CREATE TABLE Hospital (
    hospital_id   INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    address       VARCHAR(200),
    city          VARCHAR(50)  NOT NULL,
    phone         VARCHAR(15)  NOT NULL
) ENGINE=InnoDB;

CREATE TABLE Donor (
    donor_id            INT AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(100) NOT NULL,
    blood_group         ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
    phone               VARCHAR(15) NOT NULL,
    gender              ENUM('M','F','Other'),
    dob                 DATE,
    city                VARCHAR(50),
    last_donation_date  DATE,
    availability_status ENUM('Available','Unavailable') DEFAULT 'Available'
) ENGINE=InnoDB;

CREATE TABLE Recipient (
    recipient_id INT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    blood_group  ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
    phone        VARCHAR(15),
    age          INT CHECK (age > 0),
    hospital_id  INT NOT NULL,
    CONSTRAINT fk_recipient_hospital
        FOREIGN KEY (hospital_id) REFERENCES Hospital(hospital_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Blood_Request (
    request_id         INT AUTO_INCREMENT PRIMARY KEY,
    recipient_id       INT NOT NULL,
    blood_group_needed ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
    units_required     INT NOT NULL CHECK (units_required > 0),
    urgency_level      ENUM('Critical','High','Medium','Low') NOT NULL DEFAULT 'Medium',
    request_date       DATE NOT NULL,
    status             ENUM('Pending','Partially_Fulfilled','Fulfilled','Cancelled') DEFAULT 'Pending',
    CONSTRAINT fk_request_recipient
        FOREIGN KEY (recipient_id) REFERENCES Recipient(recipient_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Donation (
    donation_id   INT AUTO_INCREMENT PRIMARY KEY,
    donor_id      INT NOT NULL,
    hospital_id   INT NOT NULL,
    request_id    INT,
    donation_date DATE NOT NULL,
    units_donated INT NOT NULL CHECK (units_donated > 0),
    CONSTRAINT fk_donation_donor
        FOREIGN KEY (donor_id) REFERENCES Donor(donor_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_donation_hospital
        FOREIGN KEY (hospital_id) REFERENCES Hospital(hospital_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_donation_request
        FOREIGN KEY (request_id) REFERENCES Blood_Request(request_id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Compatibility (
    donor_blood_group     ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
    recipient_blood_group ENUM('A+','A-','B+','B-','AB+','AB-','O+','O-') NOT NULL,
    is_compatible         BOOLEAN NOT NULL,
    PRIMARY KEY (donor_blood_group, recipient_blood_group)
) ENGINE=InnoDB;

CREATE INDEX idx_donor_bg_avail  ON Donor(blood_group, availability_status);
CREATE INDEX idx_request_urgency ON Blood_Request(urgency_level, request_date);
CREATE INDEX idx_donation_donor  ON Donation(donor_id, donation_date);
