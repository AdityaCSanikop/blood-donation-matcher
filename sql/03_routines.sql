-- ============================================================
-- 03_routines.sql  —  Stored functions, stored procedures, triggers.
--
-- DIVISION OF RESPONSIBILITY (so nothing is updated twice):
--   * Triggers own every DERIVED value:
--       Blood_Request.units_fulfilled, Blood_Request.status,
--       Donor.last_donation_date.
--   * sp_record_donation owns the POLICY checks (availability, 90-day rule)
--     and inserts the Donation row. It never touches derived values.
--   * The application only calls the procedure inside a transaction and
--     never writes units_fulfilled / status(other than Cancelled) /
--     last_donation_date-after-donation itself.
--
-- Errors are raised with SQLSTATE '45000' and a machine-readable
-- MESSAGE_TEXT code that the API maps to an HTTP status + friendly text.
-- ============================================================
DELIMITER $$

-- ---------- Functions ----------------------------------------------------

-- Project assumption: a donor may donate again 90 days after the last
-- donation. A missing date means "no donation on record" -> eligible.
-- This is a simplified screening rule, NOT a clinical eligibility check.
CREATE FUNCTION fn_is_donor_eligible(p_last_donation DATE, p_as_of DATE)
RETURNS TINYINT(1)
DETERMINISTIC
NO SQL
BEGIN
    IF p_last_donation IS NULL THEN
        RETURN 1;
    END IF;
    RETURN DATEDIFF(p_as_of, p_last_donation) >= 90;
END$$

-- Single definition of how fulfilment maps to a status.
CREATE FUNCTION fn_request_status(p_required INT, p_fulfilled INT)
RETURNS VARCHAR(20)
DETERMINISTIC
NO SQL
BEGIN
    IF p_fulfilled >= p_required THEN
        RETURN 'Fulfilled';
    ELSEIF p_fulfilled > 0 THEN
        RETURN 'Partially_Fulfilled';
    END IF;
    RETURN 'Pending';
END$$

-- ---------- Triggers on Blood_Request ------------------------------------

CREATE TRIGGER trg_request_before_insert
BEFORE INSERT ON Blood_Request
FOR EACH ROW
BEGIN
    DECLARE v_recipient_hospital INT;
    DECLARE v_recipient_group    VARCHAR(3);
    DECLARE v_ok                 INT DEFAULT 0;

    SELECT hospital_id, blood_group
      INTO v_recipient_hospital, v_recipient_group
      FROM Recipient WHERE recipient_id = NEW.recipient_id;

    -- (a missing recipient is reported by the foreign key itself)
    IF v_recipient_hospital IS NOT NULL THEN
        IF NEW.hospital_id <> v_recipient_hospital THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'REQUEST_HOSPITAL_MISMATCH';
        END IF;

        -- The requested group must be one the recipient can receive.
        SELECT COUNT(*) INTO v_ok
          FROM Compatibility
         WHERE donor_blood_group     = NEW.blood_group_needed
           AND recipient_blood_group = v_recipient_group
           AND is_compatible = TRUE;
        IF v_ok = 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'REQUEST_GROUP_INCOMPATIBLE';
        END IF;
    END IF;

    -- A new request always starts empty; clients cannot pre-fill progress.
    SET NEW.units_fulfilled = 0;
    SET NEW.status = 'Pending';
END$$

CREATE TRIGGER trg_request_before_update
BEFORE UPDATE ON Blood_Request
FOR EACH ROW
BEGIN
    IF OLD.status = 'Cancelled' AND NEW.status <> 'Cancelled' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'REQUEST_CANCELLED';
    END IF;

    IF NEW.units_required < NEW.units_fulfilled THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UNITS_BELOW_FULFILLED';
    END IF;

    IF NEW.status = 'Cancelled' THEN
        IF OLD.status = 'Fulfilled' THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'REQUEST_ALREADY_FULFILLED';
        END IF;
    ELSE
        -- Status is always derived; whatever the client sent is overwritten.
        SET NEW.status = fn_request_status(NEW.units_required, NEW.units_fulfilled);
    END IF;
END$$

-- ---------- Triggers on Donation -----------------------------------------

-- Integrity gate. Runs for EVERY insert, including ones that bypass the
-- application, so over-fulfilment is impossible at the database level.
CREATE TRIGGER trg_donation_before_insert
BEFORE INSERT ON Donation
FOR EACH ROW
BEGIN
    DECLARE v_status    VARCHAR(20);
    DECLARE v_remaining INT;
    DECLARE v_hospital  INT;
    DECLARE v_needed    VARCHAR(3);
    DECLARE v_donor_grp VARCHAR(3);
    DECLARE v_ok        INT DEFAULT 0;

    IF NEW.request_id IS NOT NULL THEN
        -- FOR UPDATE: two concurrent donations for the same request queue
        -- here, so the second one sees the first one's units.
        SELECT status, units_required - units_fulfilled, hospital_id, blood_group_needed
          INTO v_status, v_remaining, v_hospital, v_needed
          FROM Blood_Request
         WHERE request_id = NEW.request_id
           FOR UPDATE;

        IF v_status IS NOT NULL THEN      -- missing request -> FK reports it
            IF v_status = 'Cancelled' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'REQUEST_CANCELLED';
            END IF;
            IF v_status = 'Fulfilled' THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'REQUEST_ALREADY_FULFILLED';
            END IF;
            IF NEW.units_donated > v_remaining THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OVER_FULFILLMENT';
            END IF;
            IF NEW.hospital_id <> v_hospital THEN
                SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DONATION_HOSPITAL_MISMATCH';
            END IF;

            SELECT blood_group INTO v_donor_grp FROM Donor WHERE donor_id = NEW.donor_id;
            IF v_donor_grp IS NOT NULL THEN
                SELECT COUNT(*) INTO v_ok
                  FROM Compatibility
                 WHERE donor_blood_group     = v_donor_grp
                   AND recipient_blood_group = v_needed
                   AND is_compatible = TRUE;
                IF v_ok = 0 THEN
                    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DONOR_INCOMPATIBLE';
                END IF;
            END IF;
        END IF;
    END IF;
END$$

-- The ONLY place fulfilment progress and last_donation_date are advanced.
CREATE TRIGGER trg_donation_after_insert
AFTER INSERT ON Donation
FOR EACH ROW
BEGIN
    UPDATE Donor
       SET last_donation_date = NEW.donation_date
     WHERE donor_id = NEW.donor_id
       AND (last_donation_date IS NULL OR last_donation_date < NEW.donation_date);

    IF NEW.request_id IS NOT NULL THEN
        -- status is recalculated by trg_request_before_update
        UPDATE Blood_Request
           SET units_fulfilled = units_fulfilled + NEW.units_donated
         WHERE request_id = NEW.request_id;
    END IF;
END$$

-- Donations are an audit record: correct a mistake by deleting and
-- re-recording, never by editing in place.
CREATE TRIGGER trg_donation_before_update
BEFORE UPDATE ON Donation
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DONATION_IMMUTABLE';
END$$

-- Reverses exactly what trg_donation_after_insert applied.
CREATE TRIGGER trg_donation_after_delete
AFTER DELETE ON Donation
FOR EACH ROW
BEGIN
    IF OLD.request_id IS NOT NULL THEN
        UPDATE Blood_Request
           SET units_fulfilled = units_fulfilled - OLD.units_donated
         WHERE request_id = OLD.request_id;
    END IF;

    -- Only roll the date back if this donation was the one that set it.
    UPDATE Donor
       SET last_donation_date = (SELECT MAX(dn.donation_date)
                                   FROM Donation dn
                                  WHERE dn.donor_id = OLD.donor_id)
     WHERE donor_id = OLD.donor_id
       AND last_donation_date = OLD.donation_date;
END$$

-- ---------- Stored procedures --------------------------------------------

-- Records one donation. Deliberately contains NO START TRANSACTION/COMMIT:
-- the caller owns the transaction so the Activity_Outbox row can be written
-- in the same atomic unit. Lock order is always request -> donor to avoid
-- deadlocks between concurrent calls.
CREATE PROCEDURE sp_record_donation(
    IN  p_donor_id      INT,
    IN  p_hospital_id   INT,
    IN  p_request_id    INT,        -- NULL = walk-in donation, no request
    IN  p_donation_date DATE,
    IN  p_units         INT,
    OUT p_donation_id   INT
)
MODIFIES SQL DATA
BEGIN
    DECLARE v_request_found INT DEFAULT 0;
    DECLARE v_donor_found   INT DEFAULT 0;
    DECLARE v_availability  VARCHAR(15);
    DECLARE v_last          DATE;

    IF p_donation_date > CURDATE() THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DONATION_DATE_IN_FUTURE';
    END IF;

    IF p_request_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_request_found
          FROM Blood_Request WHERE request_id = p_request_id FOR UPDATE;
        IF v_request_found = 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'REQUEST_NOT_FOUND';
        END IF;
    END IF;

    SELECT COUNT(*), MAX(availability_status), MAX(last_donation_date)
      INTO v_donor_found, v_availability, v_last
      FROM Donor WHERE donor_id = p_donor_id FOR UPDATE;

    IF v_donor_found = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DONOR_NOT_FOUND';
    END IF;
    IF v_availability <> 'Available' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DONOR_UNAVAILABLE';
    END IF;
    IF fn_is_donor_eligible(v_last, p_donation_date) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DONOR_NOT_ELIGIBLE';
    END IF;

    -- Fulfilment / compatibility / hospital checks and all derived updates
    -- happen in the Donation triggers.
    INSERT INTO Donation (donor_id, hospital_id, request_id, donation_date, units_donated)
    VALUES (p_donor_id, p_hospital_id, p_request_id, p_donation_date, p_units);

    SET p_donation_id = LAST_INSERT_ID();
END$$

-- Ranked list of donors who could serve a request.
--   p_only_eligible = 1 -> hide donors still inside the 90-day interval
--   p_only_eligible = 0 -> show them too, flagged, with next_eligible_date
-- Ranking: eligible first, exact blood-group match, same city as the
-- hospital, then the donor who has waited longest since donating.
CREATE PROCEDURE sp_match_donors(IN p_request_id INT, IN p_only_eligible TINYINT)
READS SQL DATA
BEGIN
    SELECT d.donor_id,
           d.name,
           d.blood_group,
           d.phone,
           d.city,
           d.last_donation_date,
           DATEDIFF(CURDATE(), d.last_donation_date)              AS days_since_last_donation,
           fn_is_donor_eligible(d.last_donation_date, CURDATE())  AS is_eligible,
           CASE WHEN d.last_donation_date IS NULL THEN NULL
                ELSE DATE_ADD(d.last_donation_date, INTERVAL 90 DAY) END AS next_eligible_date,
           (d.blood_group = br.blood_group_needed)                AS exact_group_match,
           (d.city = h.city)                                      AS same_city
      FROM Blood_Request br
      JOIN Hospital      h ON h.hospital_id = br.hospital_id
      JOIN Compatibility c ON c.recipient_blood_group = br.blood_group_needed
                          AND c.is_compatible = TRUE
      JOIN Donor         d ON d.blood_group = c.donor_blood_group
     WHERE br.request_id = p_request_id
       AND d.availability_status = 'Available'
       AND (p_only_eligible = 0
            OR fn_is_donor_eligible(d.last_donation_date, CURDATE()) = 1)
     ORDER BY is_eligible DESC,
              exact_group_match DESC,
              same_city DESC,
              (d.last_donation_date IS NULL) DESC,
              d.last_donation_date ASC,
              d.donor_id ASC;
END$$

DELIMITER ;
