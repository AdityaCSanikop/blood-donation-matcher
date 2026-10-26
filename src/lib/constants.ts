/** Shared constants. Safe to import from both server and client code. */
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

/** Declared in priority order — the same order as the MySQL ENUM. */
export const URGENCY_LEVELS = ["Critical", "High", "Medium", "Low"] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const REQUEST_STATUSES = ["Pending", "Partially_Fulfilled", "Fulfilled", "Cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const OPEN_STATUSES: RequestStatus[] = ["Pending", "Partially_Fulfilled"];

export const AVAILABILITY = ["Available", "Unavailable"] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const GENDERS = ["M", "F", "Other"] as const;
export const ROLES = ["STAFF", "DONOR"] as const;
export type Role = (typeof ROLES)[number];

/** Project assumption — see docs/DATABASE.md. Not a clinical rule. */
export const DONATION_INTERVAL_DAYS = 90;

export const DISCLAIMER =
  "Matches are a screening aid based on ABO/Rh group, availability and a 90-day interval. " +
  "They are not clinical approval: cross-matching and medical assessment by qualified staff are always required.";
