# Data dictionary

Generated from the live MySQL schema by `node scripts/data-dictionary.mjs`. Do not edit by hand.

## Hospital

A hospital or blood bank that registers recipients, raises requests and hosts donations.

| Column | Type | Null | Default | Key / reference |
|---|---|---|---|---|
| `hospital_id` | `int` | no |  | PK, AUTO_INCREMENT |
| `name` | `varchar(100)` | no |  |  |
| `address` | `varchar(200)` | yes |  |  |
| `city` | `varchar(50)` | no |  |  |
| `phone` | `varchar(15)` | no |  |  |
| `created_at` | `timestamp` | no | `CURRENT_TIMESTAMP` |  |

CHECK constraints:

- `chk_hospital_name`: `` (char_length(trim(`name`)) >= 2) ``
- `chk_hospital_phone`: `` regexp_like(`phone`,'^[+]?[0-9]{7,14}$') ``

Indexes:

- `PRIMARY` (unique): hospital_id
- `uq_hospital_name_city` (unique): name,city

## Donor

A person who can donate blood.

| Column | Type | Null | Default | Key / reference |
|---|---|---|---|---|
| `donor_id` | `int` | no |  | PK, AUTO_INCREMENT |
| `name` | `varchar(100)` | no |  |  |
| `blood_group` | `enum('A+','A-','B+','B-','AB+','AB-','O+','O-')` | no |  |  |
| `phone` | `varchar(15)` | no |  | UNIQUE |
| `gender` | `enum('M','F','Other')` | yes |  |  |
| `dob` | `date` | yes |  |  |
| `city` | `varchar(50)` | no |  |  |
| `last_donation_date` | `date` | yes |  |  |
| `availability_status` | `enum('Available','Unavailable')` | no | `Available` |  |
| `created_at` | `timestamp` | no | `CURRENT_TIMESTAMP` |  |

CHECK constraints:

- `chk_donor_name`: `` (char_length(trim(`name`)) >= 2) ``
- `chk_donor_phone`: `` regexp_like(`phone`,'^[+]?[0-9]{7,14}$') ``

Indexes:

- `ft_donor_name_city` (FULLTEXT): name,city
- `idx_donor_match` (index): availability_status,blood_group,last_donation_date
- `PRIMARY` (unique): donor_id
- `uq_donor_phone` (unique): phone

## Recipient

A patient who needs blood, registered at one hospital.

| Column | Type | Null | Default | Key / reference |
|---|---|---|---|---|
| `recipient_id` | `int` | no |  | PK, AUTO_INCREMENT |
| `name` | `varchar(100)` | no |  |  |
| `blood_group` | `enum('A+','A-','B+','B-','AB+','AB-','O+','O-')` | no |  |  |
| `phone` | `varchar(15)` | yes |  |  |
| `age` | `int` | yes |  |  |
| `hospital_id` | `int` | no |  | FK → Hospital.hospital_id (ON DELETE RESTRICT, ON UPDATE CASCADE) |

CHECK constraints:

- `chk_recipient_age_max`: `` ((`age` is null) or (`age` <= 120)) ``
- `chk_recipient_name`: `` (char_length(trim(`name`)) >= 2) ``
- `chk_recipient_phone`: `` ((`phone` is null) or regexp_like(`phone`,'^[+]?[0-9]{7,14}$')) ``
- `Recipient_chk_1`: `` (`age` > 0) ``

Indexes:

- `fk_recipient_hospital` (index): hospital_id
- `PRIMARY` (unique): recipient_id

## Blood_Request

A request for a number of units of one blood group for a recipient, with an urgency level.

| Column | Type | Null | Default | Key / reference |
|---|---|---|---|---|
| `request_id` | `int` | no |  | PK, AUTO_INCREMENT |
| `recipient_id` | `int` | no |  | FK → Recipient.recipient_id (ON DELETE RESTRICT, ON UPDATE CASCADE) |
| `hospital_id` | `int` | no |  | FK → Hospital.hospital_id (ON DELETE RESTRICT, ON UPDATE CASCADE) |
| `blood_group_needed` | `enum('A+','A-','B+','B-','AB+','AB-','O+','O-')` | no |  |  |
| `units_required` | `int` | no |  |  |
| `units_fulfilled` | `int` | no | `0` |  |
| `urgency_level` | `enum('Critical','High','Medium','Low')` | no | `Medium` |  |
| `request_date` | `date` | no |  |  |
| `status` | `enum('Pending','Partially_Fulfilled','Fulfilled','Cancelled')` | no | `Pending` |  |
| `notes` | `varchar(255)` | yes |  |  |
| `created_at` | `timestamp` | no | `CURRENT_TIMESTAMP` |  |
| `updated_at` | `timestamp` | no | `CURRENT_TIMESTAMP` |  |

CHECK constraints:

- `Blood_Request_chk_1`: `` (`units_required` > 0) ``
- `chk_request_fulfilled`: `` ((`units_fulfilled` >= 0) and (`units_fulfilled` <= `units_required`)) ``
- `chk_request_units_cap`: `` (`units_required` <= 20) ``

Indexes:

- `fk_request_hospital` (index): hospital_id
- `fk_request_recipient` (index): recipient_id
- `idx_request_queue` (index): status,urgency_level,request_date
- `PRIMARY` (unique): request_id

Triggers:

- `trg_request_before_insert` (BEFORE INSERT)
- `trg_request_before_update` (BEFORE UPDATE)

## Donation

One donation by one donor at one hospital, optionally fulfilling a request.

| Column | Type | Null | Default | Key / reference |
|---|---|---|---|---|
| `donation_id` | `int` | no |  | PK, AUTO_INCREMENT |
| `donor_id` | `int` | no |  | FK → Donor.donor_id (ON DELETE RESTRICT, ON UPDATE CASCADE) |
| `hospital_id` | `int` | no |  | FK → Hospital.hospital_id (ON DELETE RESTRICT, ON UPDATE CASCADE) |
| `request_id` | `int` | yes |  | FK → Blood_Request.request_id (ON DELETE SET NULL, ON UPDATE CASCADE) |
| `donation_date` | `date` | no |  |  |
| `units_donated` | `int` | no |  |  |
| `created_at` | `timestamp` | no | `CURRENT_TIMESTAMP` |  |

CHECK constraints:

- `chk_donation_units_cap`: `` (`units_donated` <= 2) ``
- `Donation_chk_1`: `` (`units_donated` > 0) ``

Indexes:

- `fk_donation_request` (index): request_id
- `idx_donation_donor` (index): donor_id,donation_date
- `idx_donation_hospital_date` (index): hospital_id,donation_date
- `PRIMARY` (unique): donation_id

Triggers:

- `trg_donation_after_delete` (AFTER DELETE)
- `trg_donation_after_insert` (AFTER INSERT)
- `trg_donation_before_insert` (BEFORE INSERT)
- `trg_donation_before_update` (BEFORE UPDATE)

## Compatibility

Reference table: which donor blood group can be given to which recipient blood group (all 64 pairs).

| Column | Type | Null | Default | Key / reference |
|---|---|---|---|---|
| `donor_blood_group` | `enum('A+','A-','B+','B-','AB+','AB-','O+','O-')` | no |  | PK |
| `recipient_blood_group` | `enum('A+','A-','B+','B-','AB+','AB-','O+','O-')` | no |  | PK |
| `is_compatible` | `tinyint(1)` | no |  |  |

Indexes:

- `PRIMARY` (unique): donor_blood_group,recipient_blood_group

## App_User

Login accounts. STAFF belongs to a hospital, DONOR is linked to one donor.

| Column | Type | Null | Default | Key / reference |
|---|---|---|---|---|
| `user_id` | `int` | no |  | PK, AUTO_INCREMENT |
| `email` | `varchar(120)` | no |  | UNIQUE |
| `password_hash` | `varchar(100)` | no |  |  |
| `display_name` | `varchar(100)` | no |  |  |
| `role` | `enum('STAFF','DONOR')` | no |  |  |
| `hospital_id` | `int` | yes |  | FK → Hospital.hospital_id (ON DELETE RESTRICT, ON UPDATE RESTRICT) |
| `donor_id` | `int` | yes |  | UNIQUE, FK → Donor.donor_id (ON DELETE RESTRICT, ON UPDATE RESTRICT) |
| `created_at` | `timestamp` | no | `CURRENT_TIMESTAMP` |  |

CHECK constraints:

- `chk_user_email`: `` regexp_like(`email`,'^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$') ``
- `chk_user_hash`: `` ((`password_hash` like '$2%') and (char_length(`password_hash`) = 60)) ``
- `chk_user_role_link`: `` (((`role` = 'STAFF') and (`hospital_id` is not null) and (`donor_id` is null)) or ((`role` = 'DONOR') and (`donor_id` is not null) and (`hospital_id` is null))) ``

Indexes:

- `fk_user_hospital` (index): hospital_id
- `PRIMARY` (unique): user_id
- `uq_user_donor` (unique): donor_id
- `uq_user_email` (unique): email

## Activity_Outbox

Activity events waiting to be copied to MongoDB (written in the same transaction as the change).

| Column | Type | Null | Default | Key / reference |
|---|---|---|---|---|
| `outbox_id` | `bigint` | no |  | PK, AUTO_INCREMENT |
| `event_id` | `char(36)` | no |  | UNIQUE |
| `payload` | `json` | no |  |  |
| `created_at` | `timestamp(3)` | no | `CURRENT_TIMESTAMP(3)` |  |
| `delivered_at` | `timestamp(3)` | yes |  |  |
| `attempts` | `int` | no | `0` |  |
| `last_error` | `varchar(255)` | yes |  |  |

Indexes:

- `idx_outbox_pending` (index): delivered_at,outbox_id
- `PRIMARY` (unique): outbox_id
- `uq_outbox_event` (unique): event_id

