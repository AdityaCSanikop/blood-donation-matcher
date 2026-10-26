/**
 * One error type for the whole backend, plus translation of MySQL errors
 * (constraint violations, trigger/procedure SIGNALs) into clear API errors.
 */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} was not found.`);
export const forbidden = (message = "You do not have permission to do that.") =>
  new AppError(403, "FORBIDDEN", message);

/** MESSAGE_TEXT codes raised by SIGNAL in sql/03_routines.sql. */
const SIGNALS: Record<string, [number, string]> = {
  REQUEST_HOSPITAL_MISMATCH: [422, "The request must be raised at the hospital where the recipient is registered."],
  REQUEST_GROUP_INCOMPATIBLE: [422, "The requested blood group is not one this recipient can receive."],
  REQUEST_CANCELLED: [409, "This request has been cancelled and can no longer be changed or fulfilled."],
  REQUEST_ALREADY_FULFILLED: [409, "This request is already fully fulfilled."],
  UNITS_BELOW_FULFILLED: [409, "Units required cannot be lower than the units already donated."],
  OVER_FULFILLMENT: [409, "That is more units than the request still needs."],
  DONATION_HOSPITAL_MISMATCH: [422, "The donation must be recorded at the hospital that raised the request."],
  DONOR_INCOMPATIBLE: [422, "This donor's blood group is not compatible with the request."],
  DONATION_IMMUTABLE: [409, "Donations cannot be edited. Delete the record and enter it again."],
  DONATION_DATE_IN_FUTURE: [422, "The donation date cannot be in the future."],
  REQUEST_NOT_FOUND: [404, "Blood request was not found."],
  DONOR_NOT_FOUND: [404, "Donor was not found."],
  DONOR_UNAVAILABLE: [409, "This donor is currently marked unavailable."],
  DONOR_NOT_ELIGIBLE: [409, "This donor donated less than 90 days before that date and is not yet eligible."],
};

const CHECKS: Record<string, string> = {
  chk_donor_phone: "Phone must be 7–14 digits, optionally starting with +.",
  chk_hospital_phone: "Phone must be 7–14 digits, optionally starting with +.",
  chk_recipient_phone: "Phone must be 7–14 digits, optionally starting with +.",
  chk_donor_name: "Name must have at least 2 characters.",
  chk_hospital_name: "Name must have at least 2 characters.",
  chk_recipient_name: "Name must have at least 2 characters.",
  chk_recipient_age_max: "Age must be between 1 and 120.",
  chk_request_fulfilled: "That is more units than the request still needs.",
  chk_request_units_cap: "A single request can ask for at most 20 units.",
  chk_donation_units_cap: "A single donation can be at most 2 units.",
  chk_user_email: "Enter a valid email address.",
};

const UNIQUES: Record<string, string> = {
  uq_donor_phone: "A donor with this phone number is already registered.",
  uq_user_email: "An account with this email already exists.",
  uq_user_donor: "This donor already has a login.",
  uq_hospital_name_city: "A hospital with this name already exists in that city.",
};

type MysqlError = { errno?: number; sqlMessage?: string; code?: string };

export function isTransient(err: unknown): boolean {
  const e = err as MysqlError;
  return e?.errno === 1213 || e?.errno === 1205; // deadlock, lock wait timeout
}

/** Convert anything thrown by the database layer into an AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const e = err as MysqlError;
  const msg = e?.sqlMessage ?? "";

  switch (e?.errno) {
    case 1644: {
      const hit = SIGNALS[msg];
      return hit ? new AppError(hit[0], msg, hit[1]) : new AppError(409, "RULE_VIOLATION", msg);
    }
    case 1062: {
      const key = Object.keys(UNIQUES).find((k) => msg.includes(k));
      return new AppError(409, "DUPLICATE", key ? UNIQUES[key] : "That record already exists.");
    }
    case 3819: {
      const key = Object.keys(CHECKS).find((k) => msg.includes(`'${k}'`));
      if (key === "chk_request_fulfilled") return new AppError(409, "OVER_FULFILLMENT", CHECKS[key]);
      return new AppError(422, "CONSTRAINT", key ? CHECKS[key] : "A value is outside the allowed range.");
    }
    // 1451/1452 carry the constraint details; MySQL sends the generic
    // 1217/1216 instead when the account may not see the other table
    // (which is the case for the least-privilege application account).
    case 1451:
    case 1217:
      return new AppError(409, "IN_USE", "This record is referenced by other records and cannot be deleted.");
    case 1452:
    case 1216:
      return new AppError(422, "BAD_REFERENCE", "A referenced record does not exist.");
    case 1265:
    case 1406:
    case 1366:
    case 1292:
      return new AppError(422, "BAD_VALUE", "A value has the wrong format or is too long.");
    case 1213:
    case 1205:
      return new AppError(503, "BUSY", "The database is busy. Please try again.");
  }
  return new AppError(500, "INTERNAL", "Something went wrong on the server.");
}
