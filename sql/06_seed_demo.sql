-- ============================================================
-- 06_seed_demo.sql  —  FICTIONAL demo data (no real people or hospitals).
-- Dates are relative to CURDATE() so the 90-day examples stay meaningful
-- whenever the seed is loaded.
-- Donations are inserted oldest-first and go through the same triggers as
-- the application, so units_fulfilled / status / last_donation_date below
-- are all computed by the database, not typed in.
-- ============================================================

INSERT INTO Hospital (hospital_id, name, address, city, phone) VALUES
 (1, 'Lakeside General Hospital',  '12 Tank Bund Road',      'Bengaluru',  '08000000101'),
 (2, 'Nandi Hills Medical Centre', '4 Orchard Layout',       'Bengaluru',  '08000000102'),
 (3, 'Kaveri Community Hospital',  '77 River View Street',   'Mysuru',     '08000000103'),
 (4, 'Malnad Care Hospital',       '9 Areca Garden Road',    'Shivamogga', '08000000104'),
 (5, 'Coastal Mercy Hospital',     '31 Lighthouse Avenue',   'Mangaluru',  '08000000105'),
 (6, 'Deccan Heart Institute',     '18 Unkal Lake Road',     'Hubballi',   '08000000106'),
 (7, 'Udupi Coastal Clinic',       '5 Temple Car Street',    'Udupi',      '08000000107'),
 (8, 'Garden City Children''s Hospital', '22 Cubbon Lane',  'Bengaluru',  '08000000108'),
 (9, 'Tumakuru District Hospital', '3 Siddaganga Road',      'Tumakuru',   '08000000109'),
 (10,'Belagavi Trauma Care Centre','41 Fort Road',           'Belagavi',   '08000000110');

-- last_donation_date is given only where the donor reported a donation made
-- outside this system; the rest is filled in by the Donation trigger.
INSERT INTO Donor (donor_id, name, blood_group, phone, gender, dob, city, last_donation_date, availability_status) VALUES
 ( 1, 'Arjun Rao',       'O+',  '9000000001', 'M', '1996-03-14', 'Bengaluru',  NULL, 'Available'),
 ( 2, 'Meera Nair',      'O-',  '9000000002', 'F', '1990-07-02', 'Bengaluru',  NULL, 'Available'),
 ( 3, 'Kiran Shetty',    'A+',  '9000000003', 'M', '1988-11-23', 'Bengaluru',  NULL, 'Available'),
 ( 4, 'Divya Hegde',     'A-',  '9000000004', 'F', '1999-01-30', 'Mysuru',     NULL, 'Available'),
 ( 5, 'Rahul Gowda',     'B+',  '9000000005', 'M', '1993-05-19', 'Bengaluru',  NULL, 'Available'),
 ( 6, 'Sneha Kulkarni',  'B-',  '9000000006', 'F', '1995-09-08', 'Bengaluru',  NULL, 'Unavailable'),
 ( 7, 'Vikram Patil',    'AB+', '9000000007', 'M', '1985-12-12', 'Mangaluru',  NULL, 'Available'),
 ( 8, 'Ananya Bhat',     'AB-', '9000000008', 'F', '2001-04-25', 'Bengaluru',  NULL, 'Available'),
 ( 9, 'Suresh Naik',     'O+',  '9000000009', 'M', '1979-08-17', 'Mysuru',     NULL, 'Available'),
 (10, 'Lakshmi Iyer',    'O-',  '9000000010', 'F', '1992-02-11', 'Mysuru',     NULL, 'Available'),
 (11, 'Imran Khan',      'A+',  '9000000011', 'M', '1997-06-05', 'Bengaluru',  NULL, 'Available'),
 (12, 'Priya Fernandes', 'A+',  '9000000012', 'F', '1991-10-29', 'Bengaluru',  NULL, 'Available'),
 (13, 'Naveen Reddy',    'B+',  '9000000013', 'M', '1987-03-03', 'Shivamogga', NULL, 'Available'),
 (14, 'Fatima Sheikh',   'B+',  '9000000014', 'F', '1994-12-21', 'Mangaluru',  NULL, 'Available'),
 (15, 'Rohan Desai',     'O+',  '9000000015', 'M', '1990-01-09', 'Bengaluru',  NULL, 'Available'),
 (16, 'Kavya Murthy',    'A-',  '9000000016', 'F', '1998-07-27', 'Bengaluru',  NULL, 'Available'),
 (17, 'Joseph Mathew',   'B-',  '9000000017', 'M', '1983-05-06', 'Mangaluru',  NULL, 'Available'),
 (18, 'Pooja Acharya',   'AB+', '9000000018', 'F', '1996-11-11', 'Bengaluru',  NULL, 'Unavailable'),
 (19, 'Manoj Kamath',    'O-',  '9000000019', 'M', '1989-09-15', 'Shivamogga', NULL, 'Available'),
 (20, 'Sahana Joshi',    'O+',  '9000000020', 'F', '2000-02-28', 'Mysuru',     NULL, 'Available'),
 (21, 'Tejas Pai',       'A+',  '9000000021', 'M', '1995-04-04', 'Mysuru',     NULL, 'Available'),
 (22, 'Nisha Menon',     'AB-', '9000000022', 'F', '1986-06-18', 'Mysuru',     NULL, 'Available'),
 (23, 'Harish Babu',     'B+',  '9000000023', 'M', '1992-08-08', 'Mysuru',     DATE_SUB(CURDATE(), INTERVAL 20 DAY), 'Available'),
 (24, 'Deepa Ramesh',    'O+',  '9000000024', 'F', '1984-10-01', 'Mangaluru',  NULL, 'Unavailable');

INSERT INTO Recipient (recipient_id, name, blood_group, phone, age, hospital_id) VALUES
 ( 1, 'Ramesh Kumar',    'B-',  '9100000001', 54, 1),
 ( 2, 'Sunita Devi',     'O-',  '9100000002', 31, 1),
 ( 3, 'Aarav Singh',     'AB+', NULL,          6, 2),
 ( 4, 'Geetha Prasad',   'A+',  '9100000004', 47, 2),
 ( 5, 'Mohammed Yusuf',  'O+',  '9100000005', 62, 3),
 ( 6, 'Shalini Rao',     'AB-', '9100000006', 28, 3),
 ( 7, 'Prakash Shenoy',  'A-',  '9100000007', 39, 5),
 ( 8, 'Latha Krishnan',  'B+',  '9100000008', 70, 4),
 ( 9, 'Vinod Hegde',     'O+',  '9100000009', 23, 1),
 (10, 'Rekha Pinto',     'AB+', '9100000010', 58, 5);

INSERT INTO Blood_Request (request_id, recipient_id, hospital_id, blood_group_needed, units_required, urgency_level, request_date, notes) VALUES
 ( 1,  1, 1, 'B-',  2, 'Critical', DATE_SUB(CURDATE(), INTERVAL   1 DAY), 'Emergency surgery; rare group'),
 ( 2,  2, 1, 'O-',  3, 'Critical', CURDATE(),                             'Post-operative bleeding'),
 ( 3,  3, 2, 'AB+', 1, 'Low',      DATE_SUB(CURDATE(), INTERVAL   6 DAY), 'Planned procedure next week'),
 ( 4,  4, 2, 'A+',  2, 'High',     DATE_SUB(CURDATE(), INTERVAL  32 DAY), 'Ongoing treatment'),
 ( 5,  5, 3, 'O+',  2, 'Medium',   DATE_SUB(CURDATE(), INTERVAL  62 DAY), NULL),
 ( 6,  6, 3, 'AB-', 1, 'High',     DATE_SUB(CURDATE(), INTERVAL   3 DAY), 'Rare group'),
 ( 7,  7, 5, 'A-',  2, 'Medium',   DATE_SUB(CURDATE(), INTERVAL   4 DAY), NULL),
 ( 8,  8, 4, 'B+',  1, 'Low',      DATE_SUB(CURDATE(), INTERVAL  10 DAY), 'Procedure postponed'),
 ( 9,  9, 1, 'O+',  4, 'High',     CURDATE(),                             'Road accident'),
 (10, 10, 5, 'AB+', 2, 'Medium',   DATE_SUB(CURDATE(), INTERVAL  12 DAY), NULL),
 (11,  8, 4, 'B+',  1, 'Medium',   DATE_SUB(CURDATE(), INTERVAL 125 DAY), NULL),
 (12,  4, 2, 'A+',  1, 'Low',      DATE_SUB(CURDATE(), INTERVAL 160 DAY), NULL);

-- Oldest first. request_id NULL = walk-in donation not tied to a request.
INSERT INTO Donation (donor_id, hospital_id, request_id, donation_date, units_donated) VALUES
 (22, 3, NULL, DATE_SUB(CURDATE(), INTERVAL 500 DAY), 1),
 ( 7, 5, NULL, DATE_SUB(CURDATE(), INTERVAL 400 DAY), 1),
 (15, 1, NULL, DATE_SUB(CURDATE(), INTERVAL 365 DAY), 1),
 ( 2, 1, NULL, DATE_SUB(CURDATE(), INTERVAL 200 DAY), 1),
 (12, 2, 12,   DATE_SUB(CURDATE(), INTERVAL 150 DAY), 1),
 ( 5, 4, 11,   DATE_SUB(CURDATE(), INTERVAL 120 DAY), 1),
 ( 9, 3, NULL, DATE_SUB(CURDATE(), INTERVAL  95 DAY), 1),
 (16, 2, NULL, DATE_SUB(CURDATE(), INTERVAL  91 DAY), 1),
 (21, 3, NULL, DATE_SUB(CURDATE(), INTERVAL  90 DAY), 1),   -- exactly 90 days: eligible today
 (17, 5, NULL, DATE_SUB(CURDATE(), INTERVAL  89 DAY), 1),   -- 89 days: eligible tomorrow
 (10, 3, 5,    DATE_SUB(CURDATE(), INTERVAL  60 DAY), 1),
 (20, 3, 5,    DATE_SUB(CURDATE(), INTERVAL  45 DAY), 1),   -- request 5 -> Fulfilled
 ( 3, 2, 4,    DATE_SUB(CURDATE(), INTERVAL  30 DAY), 1),   -- request 4 -> Partially_Fulfilled
 (14, 5, 10,   DATE_SUB(CURDATE(), INTERVAL  10 DAY), 1);   -- request 10 -> Partially_Fulfilled

UPDATE Blood_Request SET status = 'Cancelled' WHERE request_id = 8;
