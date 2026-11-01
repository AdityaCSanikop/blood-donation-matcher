-- ============================================================
-- 09_donor_response.sql  —  A donor offers to help with an open request.
-- An offer is not a donation: staff still contact the donor, decide,
-- and record any donation themselves.
-- Demonstrates: composite PRIMARY KEY, ON DELETE CASCADE.
-- ============================================================
CREATE TABLE IF NOT EXISTS Donor_Response (
    donor_id     INT       NOT NULL,
    request_id   INT       NOT NULL,
    responded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (donor_id, request_id),
    CONSTRAINT fk_response_donor   FOREIGN KEY (donor_id)   REFERENCES Donor (donor_id)           ON DELETE CASCADE,
    CONSTRAINT fk_response_request FOREIGN KEY (request_id) REFERENCES Blood_Request (request_id) ON DELETE CASCADE
);
