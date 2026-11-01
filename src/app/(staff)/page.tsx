"use client";
import Link from "next/link";
import { useMe } from "@/components/AppShell";
import { BloodGroupTag, Empty, LinkButton, Loading, LoadError, Notice, PageHeader, Panel, Stat, StatusTag, Table, UnitMeter, URGENCY_BAR, UrgencyTag, cx } from "@/components/ui";
import { formatDate } from "@/lib/client";
import { DISCLAIMER, type BloodGroup, type RequestStatus, type UrgencyLevel } from "@/lib/constants";
import { useLoad } from "@/lib/hooks";

type QueueRow = {
  request_id: number;
  recipient_name: string;
  hospital_name: string;
  hospital_city: string;
  blood_group_needed: BloodGroup;
  units_required: number;
  units_fulfilled: number;
  units_remaining: number;
  urgency_level: UrgencyLevel;
  request_date: string;
  days_waiting: number;
  eligible_donor_count: number;
};
type Dashboard = {
  totals: Record<string, number>;
  queue: QueueRow[];
  blood_groups: { blood_group: BloodGroup; registered_donors: number; donors_ready_now: number; compatible_donors_ready: number; units_outstanding: number }[];
  hospitals: { hospital_id: number; name: string; city: string; donation_count: number; units_collected: number; distinct_donors: number; open_requests: number; units_outstanding: number }[];
  shortages: { blood_group: BloodGroup; open_requests: number; units_needed: number; eligible_donors: number; highest_urgency: UrgencyLevel }[];
  repeat_donors: { donor_id: number; name: string; blood_group: BloodGroup; donations: number; units: number; last_donation: string }[];
  pending_activity_logs: number;
};
type RecentRow = { request_id: number; recipient_name: string; hospital_name: string; blood_group_needed: BloodGroup; urgency_level: UrgencyLevel; request_date: string; status: RequestStatus };

export default function DashboardPage() {
  const me = useMe();
  const { data, error, loading, reload } = useLoad<Dashboard>("/api/stats");
  const all = useLoad<RecentRow[]>("/api/requests?status=all");
  const recent = [...(all.data ?? [])].sort((a, b) => b.request_date.localeCompare(a.request_date) || b.request_id - a.request_id).slice(0, 5);

  return (
    <>
      <PageHeader
        title="Dashboard"
        lead={`${me.hospital_name ?? "Your hospital"}${me.hospital_city ? `, ${me.hospital_city}` : ""}. The queue below covers every hospital on the network.`}
        action={<LinkButton href="/requests?new=1" variant="primary">Raise a blood request</LinkButton>}
      />
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !data && <Loading what="Loading the dashboard" />}
      {data && (
        <div className="space-y-6">
          {data.shortages.length > 0 && (
            <Notice tone="warn">
              Not enough eligible donors right now for:{" "}
              {data.shortages.map((s, i) => (
                <span key={s.blood_group}>
                  {i > 0 && ", "}
                  <strong>{s.blood_group}</strong> ({s.units_needed} unit{s.units_needed === 1 ? "" : "s"} needed, {s.eligible_donors} donor
                  {s.eligible_donors === 1 ? "" : "s"})
                </span>
              ))}
              .
            </Notice>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Open requests" value={data.totals.open_requests} />
            <Stat label="Critical, still open" value={data.totals.critical_open} tone={data.totals.critical_open > 0 ? "bad" : undefined} />
            <Stat label="Units still needed" value={data.totals.units_outstanding} />
            <Stat label="Donors who can give today" value={data.totals.donors_ready} note={`of ${data.totals.donors_total} registered`} />
          </div>

          <Panel title="Most urgent open requests" action={<Link href="/requests" className="text-sm text-ink-soft hover:text-ink">See all requests</Link>}>
            {data.queue.length === 0 ? (
              <Empty title="No open requests">Every request has been fulfilled or cancelled.</Empty>
            ) : (
              <ol className="space-y-1.5">
                {data.queue.map((r) => (
                  <li key={r.request_id}>
                    <Link
                      href={`/requests/${r.request_id}`}
                      className={cx("grid items-center gap-x-4 gap-y-1 rounded-md bg-elevated/40 px-3 py-2.5 transition-colors duration-150 hover:bg-elevated grid-cols-[4.75rem_1fr] sm:grid-cols-[4.75rem_3.25rem_1fr_auto]", URGENCY_BAR[r.urgency_level])}
                    >
                      <UrgencyTag level={r.urgency_level} />
                      <BloodGroupTag group={r.blood_group_needed} />
                      <span className="col-span-2 min-w-0 text-sm sm:col-span-1">
                        <span className="font-medium">{r.recipient_name}</span>
                        <span className="text-ink-soft"> at {r.hospital_name}, {r.hospital_city}</span>
                        <span className="block text-[13px] text-ink-soft">
                          Raised {formatDate(r.request_date)}
                          {r.days_waiting > 0 ? `, waiting ${r.days_waiting} day${r.days_waiting === 1 ? "" : "s"}` : ", today"}
                        </span>
                      </span>
                      <span className="col-span-2 sm:col-span-1 sm:text-right">
                        <UnitMeter required={r.units_required} fulfilled={r.units_fulfilled} />
                        <span className={cx("block text-[13px]", r.eligible_donor_count === 0 ? "font-medium text-venous" : "text-ink-soft")}>
                          {r.eligible_donor_count === 0 ? "No eligible donor" : `${r.eligible_donor_count} eligible donor${r.eligible_donor_count === 1 ? "" : "s"}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Recent blood requests">
            {all.error && <LoadError message={all.error} onRetry={all.reload} />}
            {all.loading && !all.data && <Loading what="Loading requests" />}
            {all.data && (
              <Table head={["Recipient", "Hospital", "Needs", "Urgency", "Raised", "Status", ""]}>
                {recent.map((r) => (
                  <tr key={r.request_id}>
                    <td className="font-medium">{r.recipient_name}</td>
                    <td>{r.hospital_name}</td>
                    <td><BloodGroupTag group={r.blood_group_needed} /></td>
                    <td><UrgencyTag level={r.urgency_level} /></td>
                    <td className="whitespace-nowrap">{formatDate(r.request_date)}</td>
                    <td><StatusTag status={r.status} /></td>
                    <td className="text-right"><Link href={`/requests/${r.request_id}`} className="font-medium whitespace-nowrap text-venous hover:underline">Open</Link></td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>

          {/* The reporting views stay one click away for the demonstration, without crowding the page. */}
          <details className="group rounded-lg border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold select-none">Network reports</summary>
            <div className="space-y-6 border-t border-line-soft p-4">
              <p className="text-sm text-ink-soft"><span className="tabular font-medium text-ink">{data.totals.units_last_30_days}</span> units donated in the last 30 days.</p>
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="mb-2 text-sm font-semibold">Supply and demand by blood group</h3>
                  <Table compact head={["Group", "Can give today", "Compatible donors ready", "Units needed"]}>
                    {data.blood_groups.map((g) => (
                      <tr key={g.blood_group}>
                        <td><BloodGroupTag group={g.blood_group} /></td>
                        <td className="tabular">{g.donors_ready_now} <span className="text-ink-soft">of {g.registered_donors}</span></td>
                        <td className="tabular">{g.compatible_donors_ready}</td>
                        <td className={cx("tabular", g.units_outstanding > g.compatible_donors_ready && "font-semibold text-venous")}>{g.units_outstanding}</td>
                      </tr>
                    ))}
                  </Table>
                  <p className="mt-3 text-sm text-ink-soft">“Compatible donors ready” counts every donor whose group can be given to that group, not only exact matches.</p>
                </div>
                <div className="min-w-0">
                  <h3 className="mb-2 text-sm font-semibold">Donations by hospital</h3>
                  <Table compact head={["Hospital", "Donations", "Units", "Donors", "Open requests"]}>
                    {data.hospitals.map((h) => (
                      <tr key={h.hospital_id}>
                        <td>
                          <span className="font-medium">{h.name}</span>
                          <span className="block text-sm text-ink-soft">{h.city}</span>
                        </td>
                        <td className="tabular">{h.donation_count}</td>
                        <td className="tabular">{h.units_collected}</td>
                        <td className="tabular">{h.distinct_donors}</td>
                        <td className="tabular">{h.open_requests}{h.units_outstanding > 0 && <span className="text-ink-soft"> ({h.units_outstanding} units)</span>}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </div>
              {data.repeat_donors.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Donors who have given more than once</h3>
                  <Table head={["Donor", "Group", "Donations", "Units", "Most recent"]}>
                    {data.repeat_donors.map((d) => (
                      <tr key={d.donor_id}>
                        <td className="font-medium">{d.name}</td>
                        <td><BloodGroupTag group={d.blood_group} /></td>
                        <td className="tabular">{d.donations}</td>
                        <td className="tabular">{d.units}</td>
                        <td>{formatDate(d.last_donation)}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
            </div>
          </details>

          {data.pending_activity_logs > 0 && (
            <Notice tone="info">
              {data.pending_activity_logs} activity log entr{data.pending_activity_logs === 1 ? "y is" : "ies are"} waiting to be copied to MongoDB.{" "}
              <Link href="/activity" className="underline">Open the activity log</Link> to retry.
            </Notice>
          )}
          <p className="max-w-[80ch] text-sm text-ink-soft">{DISCLAIMER}</p>
        </div>
      )}
    </>
  );
}
