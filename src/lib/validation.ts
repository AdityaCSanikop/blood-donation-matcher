/** Server-side input validation (zod). The database repeats the critical rules as constraints. */
import { z } from "zod";
import { AVAILABILITY, BLOOD_GROUPS, GENDERS, REQUEST_STATUSES, URGENCY_LEVELS } from "./constants";
import { AppError } from "./errors";

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(min, `${label} must have at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

const phone = z
  .string({ error: "Phone is required." })
  .trim()
  .regex(/^\+?[0-9]{7,14}$/, "Phone must be 7–14 digits, optionally starting with +.");

const isoDate = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date in YYYY-MM-DD format.`)
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, `${label} is not a real calendar date.`);

const notInFuture = (label: string) =>
  isoDate(label).refine((s) => s <= localToday(1), `${label} cannot be in the future.`);

/** Today's date as YYYY-MM-DD, with slack for time-zone differences (the DB has the final say). */
function localToday(slackDays = 0): string {
  const d = new Date(Date.now() + slackDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const id = (label: string) => z.coerce.number({ error: `${label} is required.` }).int().positive(`${label} is invalid.`);
const bloodGroup = z.enum(BLOOD_GROUPS, { error: "Choose a valid blood group." });
const nullable = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" || v === undefined ? null : v), schema.nullable());

export const hospitalSchema = z.object({
  name: trimmed(2, 100, "Name"),
  address: nullable(trimmed(1, 200, "Address")),
  city: trimmed(2, 50, "City"),
  phone,
});

export const donorSchema = z.object({
  name: trimmed(2, 100, "Name"),
  blood_group: bloodGroup,
  phone,
  gender: nullable(z.enum(GENDERS, { error: "Choose a valid gender." })),
  dob: nullable(notInFuture("Date of birth")),
  city: trimmed(2, 50, "City"),
  last_donation_date: nullable(notInFuture("Last donation date")),
  availability_status: z.enum(AVAILABILITY).default("Available"),
});
export const donorUpdateSchema = donorSchema.omit({ availability_status: true, last_donation_date: true }).partial();
export const availabilitySchema = z.object({
  availability_status: z.enum(AVAILABILITY, { error: "Availability must be Available or Unavailable." }),
});

export const recipientSchema = z.object({
  name: trimmed(2, 100, "Name"),
  blood_group: bloodGroup,
  phone: nullable(phone),
  age: nullable(z.coerce.number().int("Age must be a whole number.").min(1, "Age must be between 1 and 120.").max(120, "Age must be between 1 and 120.")),
});

const units = (max: number, label: string) =>
  z.coerce
    .number({ error: `${label} is required.` })
    .int(`${label} must be a whole number.`)
    .min(1, `${label} must be at least 1.`)
    .max(max, `${label} can be at most ${max}.`);

export const requestSchema = z.object({
  recipient_id: id("Recipient"),
  blood_group_needed: bloodGroup.optional(), // defaults to the recipient's own group
  units_required: units(20, "Units required"),
  urgency_level: z.enum(URGENCY_LEVELS, { error: "Choose a valid urgency level." }).default("Medium"),
  notes: nullable(trimmed(1, 255, "Notes")),
});
export const requestUpdateSchema = z
  .object({
    units_required: units(20, "Units required").optional(),
    urgency_level: z.enum(URGENCY_LEVELS, { error: "Choose a valid urgency level." }).optional(),
    notes: nullable(trimmed(1, 255, "Notes")).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const donationSchema = z.object({
  donor_id: id("Donor"),
  request_id: nullable(id("Request")),
  donation_date: nullable(notInFuture("Donation date")),
  units_donated: units(2, "Units donated").default(1),
});

const password = z
  .string({ error: "Password is required." })
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.");
const email = z.string({ error: "Email is required." }).trim().toLowerCase().email("Enter a valid email address.").max(120);

export const loginSchema = z.object({ email, password: z.string({ error: "Password is required." }).min(1, "Password is required.") });
export const donorRegistrationSchema = donorSchema.omit({ availability_status: true }).extend({ email, password });
export const staffUserSchema = z.object({ email, password, display_name: trimmed(2, 100, "Name") });

export const hospitalCreateSchema = hospitalSchema.extend({ first_staff: staffUserSchema.optional() });

export const requestStatusFilter = z.enum([...REQUEST_STATUSES, "open", "all"]).default("open");

/** Parse or throw a 422 AppError carrying per-field messages. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "_";
    if (!fields[path]) fields[path] = issue.message;
  }
  const first = Object.values(fields)[0] ?? "Invalid input.";
  throw new AppError(422, "VALIDATION", first, { fields });
}

export function parseId(value: string | undefined, label = "Id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(400, "BAD_ID", `${label} must be a positive whole number.`);
  return n;
}
