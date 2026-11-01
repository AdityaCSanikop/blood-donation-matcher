"use client";
import { useState } from "react";
import { useMe } from "@/components/AppShell";
import { ActivityList, type ActivityItem } from "@/components/ActivityList";
import { BloodGroupTag, Button, Empty, Loading, LoadError, Notice, PageHeader, Panel, Table, UrgencyTag } from "@/components/ui";
import { api, errorMessage, formatDate } from "@/lib/client";
import type { Availability, BloodGroup, UrgencyLevel } from "@/lib/constants";
import { useLoad } from "@/lib/hooks";

type Profile = {
  donor_id: number;
  name: string;
  blood_group: BloodGroup;
  phone: string;
  city: string;
  availability_status: Availability;
  last_donation_date: string | null;
  days_since_last_donation: number | null;
  is_eligible: number;
  can_donate_now: number;
  next_eligible_date: string | null;
  donations: { donation_id: number; donation_date: string; units_donated: number; hospital_name: string }[];
};
type OpenRequest = { request_id: number; hospital_name: string; hospital_city: string; blood_group_needed: BloodGroup; units_remaining: number; urgency_level: UrgencyLevel; days_waiting: number; offered_help: number };

export default function MyProfilePage() {
  const me = useMe();
  const profile = useLoad<Profile>(`/api/donors/${me.donor_id}`);
  const requests = useLoad<OpenRequest[]>(`/api/donors/${me.donor_id}/requests`);
  const activity = useLoad<ActivityItem[]>("/api/activity?limit=10");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const p = profile.data;

  async function toggle() {
    if (!p) return;
    setBusy(true);
    const next: Availability = p.availability_status === "Available" ? "Unavailable" : "Available";
    try {
      await api(`/api/donors/${p.donor_id}/availability`, { method: "PATCH", body: { availability_status: next } });
      setNotice({ tone: "success", text: next === "Available" ? "You are marked available. Hospitals can now find you." : "You are marked unavailable. Hospitals will not see you in matches." });
      await Promise.all([profile.reload(), activity.reload()]);
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function respond(r: OpenRequest) {
    setBusy(true);
    const offered = Number(r.offered_help) === 1;
    try {
      await api(`/api/donors/${me.donor_id}/requests/${r.request_id}/response`, { method: offered ? "DELETE" : "POST" });
      setNotice({ tone: "success", text: offered ? "Your offer was withdrawn." : `${r.hospital_name} can now see that you offered to help.` });
      await Promise.all([requests.reload(), activity.reload()]);
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (profile.error) return <LoadError message={profile.error} onRetry={profile.reload} />;
  if (!p) return <Loading what="Loading your profile" />;

  const status = Number(p.can_donate_now)
    ? { tone: "success" as const, text: "You can donate today." }
    : p.availability_status === "Unavailable"
      ? { tone: "info" as const, text: "You are marked unavailable, so hospitals will not contact you." }
      : { tone: "warn" as const, text: `You donated ${p.days_since_last_donation} days ago. You can donate again from ${formatDate(p.next_eligible_date)}.` };

  return (
    <>
      <PageHeader title={`Hello, ${p.name}`} lead={`${p.city}. Phone ${p.phone}.`} />
      <div className="space-y-6">
        {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
        <Panel>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <BloodGroupTag group={p.blood_group} size="lg" />
            <div className="min-w-60 flex-1">
              <Notice tone={status.tone}>{status.text}</Notice>
              <p className="mt-2 text-sm text-ink-soft">Last donation: {p.last_donation_date ? formatDate(p.last_donation_date) : "None on record"}</p>
            </div>
            <div>
              <p className="mb-1 text-sm text-ink-soft">Availability: <strong className="font-medium text-ink">{p.availability_status}</strong></p>
              <Button variant={p.availability_status === "Available" ? "secondary" : "primary"} busy={busy} onClick={toggle}>
                {p.availability_status === "Available" ? "Mark me unavailable" : "Mark me available"}
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Open requests your blood group can help">
          {requests.error && <LoadError message={requests.error} onRetry={requests.reload} />}
          {requests.loading && !requests.data && <Loading />}
          {requests.data && requests.data.length === 0 && <Empty title="No open requests need your group right now">Check back later. Staying marked available lets hospitals find you.</Empty>}
          {requests.data && requests.data.length > 0 && (
            <>
              <Table head={["Urgency", "Needs", "Hospital", "Units still needed", "Waiting", ""]}>
                {requests.data.map((r) => (
                  <tr key={r.request_id}>
                    <td><UrgencyTag level={r.urgency_level} /></td>
                    <td><BloodGroupTag group={r.blood_group_needed} /></td>
                    <td>{r.hospital_name}, {r.hospital_city}</td>
                    <td className="tabular">{r.units_remaining}</td>
                    <td>{r.days_waiting === 0 ? "Since today" : `${r.days_waiting} day${r.days_waiting === 1 ? "" : "s"}`}</td>
                    <td>
                      {(Number(r.offered_help) === 1 || Number(p.can_donate_now) === 1) && (
                        <Button variant={Number(r.offered_help) === 1 ? "secondary" : "primary"} busy={busy} onClick={() => void respond(r)}>
                          {Number(r.offered_help) === 1 ? "Withdraw offer" : "I can help"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
              <p className="mt-3 text-sm text-ink-soft">Patient details are never shown here. The hospital contacts you and makes the final medical decision.</p>
            </>
          )}
        </Panel>

        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="Your donations">
            {p.donations.length === 0 ? (
              <Empty title="No donations recorded yet">Donations a hospital records for you appear here.</Empty>
            ) : (
              <Table compact head={["Date", "Hospital", "Units"]}>
                {p.donations.map((d) => (
                  <tr key={d.donation_id}>
                    <td>{formatDate(d.donation_date)}</td>
                    <td>{d.hospital_name}</td>
                    <td className="tabular">{d.units_donated}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
          <Panel title="Notifications">
            {activity.error && <LoadError message={activity.error} onRetry={activity.reload} />}
            {activity.data && activity.data.length === 0 && <Empty title="Nothing yet" />}
            {activity.data && activity.data.length > 0 && <ActivityList items={activity.data} />}
          </Panel>
        </div>
      </div>
    </>
  );
}
