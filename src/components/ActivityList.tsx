"use client";
import { formatDateTime } from "@/lib/client";

export type ActivityItem = {
  event_id: string;
  entity_type: string;
  entity_id: number;
  action: string;
  timestamp: string;
  details: Record<string, unknown>;
  performed_by: { user_id: number | null; role: string; email: string | null };
  related: Record<string, number>;
};

const text = (v: unknown) => String(v ?? "").replace(/_/g, " ");

/** Turn one log document into a plain sentence; the details differ per action. */
function describe(item: ActivityItem): string {
  const d = item.details;
  switch (item.action) {
    case "donor_availability_changed":
      return `Donor #${item.entity_id} changed from ${text(d.old_status)} to ${text(d.new_status)}`;
    case "donor_registered":
      return `Donor #${item.entity_id} registered (${text(d.blood_group)}, ${text(d.city)}) by ${d.registered_by === "self" ? "the donor" : "hospital staff"}`;
    case "donor_profile_updated":
      return `Donor #${item.entity_id} profile updated: ${(d.changed_fields as string[] | undefined)?.map(text).join(", ") ?? "details"}`;
    case "request_created":
      return `Request #${item.entity_id} raised: ${text(d.units_required)} unit(s) of ${text(d.blood_group)}, ${text(d.urgency)} urgency`;
    case "request_status_changed":
      return `Request #${item.entity_id} went from ${text(d.old_status)} to ${text(d.new_status)}${d.reason ? ` (${text(d.reason)})` : ""}`;
    case "request_updated": {
      const changes = Object.entries((d.changes ?? {}) as Record<string, { from: unknown; to: unknown }>)
        .map(([k, v]) => `${text(k)} ${text(v.from) || "empty"} to ${text(v.to) || "empty"}`)
        .join("; ");
      return `Request #${item.entity_id} edited: ${changes}`;
    }
    case "donation_recorded":
      return `Donation #${item.entity_id} recorded: ${text(d.units_donated)} unit(s) from donor #${item.related.donor_id}${
        item.related.request_id ? ` for request #${item.related.request_id}` : " (walk-in)"
      }`;
    case "donation_deleted":
      return `Donation #${item.entity_id} deleted (${text(d.units_donated)} unit(s) from donor #${item.related.donor_id})`;
    case "recipient_registered":
      return `Recipient #${item.entity_id} registered (${text(d.blood_group)})`;
    case "hospital_registered":
      return `Hospital #${item.entity_id} registered: ${text(d.name)}, ${text(d.city)}`;
    default:
      return `${text(item.action)} on ${item.entity_type} #${item.entity_id}`;
  }
}

export function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <ol className="divide-y divide-line-soft">
      {items.map((item) => (
        <li key={item.event_id} className="grid gap-x-4 py-2.5 sm:grid-cols-[9.5rem_1fr]">
          <time dateTime={item.timestamp} className="tabular text-sm text-ink-soft">{formatDateTime(item.timestamp)}</time>
          <div>
            <p>{describe(item)}</p>
            <p className="text-sm text-ink-soft">
              {item.performed_by.role === "SYSTEM" ? "System" : `${item.performed_by.role === "STAFF" ? "Staff" : "Donor"}${item.performed_by.email ? `, ${item.performed_by.email}` : ""}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
