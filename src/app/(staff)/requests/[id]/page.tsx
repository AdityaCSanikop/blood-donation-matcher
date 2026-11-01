"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/AppShell";
import { ArrowIcon, RefreshIcon } from "@/components/icons";
import { BloodGroupTag, Button, Empty, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Pill, Select, StatusTag, Table, UnitMeter, URGENCY_BAR, UrgencyTag } from "@/components/ui";
import { api, errorMessage, formatDate, todayIso } from "@/lib/client";
import { DISCLAIMER, URGENCY_LEVELS, type BloodGroup, type RequestStatus, type UrgencyLevel } from "@/lib/constants";
import { useLoad } from "@/lib/hooks";

type Donation = { donation_id: number; donation_date: string; units_donated: number; donor_id: number; donor_name: string; donor_blood_group: BloodGroup };
type RequestDetail = {
  request_id: number;
  recipient_name: string;
  recipient_blood_group: BloodGroup;
  hospital_id: number;
  hospital_name: string;
  hospital_city: string;
  blood_group_needed: BloodGroup;
  units_required: number;
  units_fulfilled: number;
  units_remaining: number;
  urgency_level: UrgencyLevel;
  request_date: string;
  days_waiting: number;
  status: RequestStatus;
  notes: string | null;
  donations: Donation[];
};
type Match = {
  donor_id: number;
  name: string;
  blood_group: BloodGroup;
  phone: string;
  city: string;
  last_donation_date: string | null;
  days_since_last_donation: number | null;
  is_eligible: number;
  next_eligible_date: string | null;
  exact_group_match: number;
  same_city: number;
  offered_help: boolean;
};
type Matches = { matches: Match[]; summary: { eligible: number; listed: number; units_remaining: number }; message: string | null };

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [includeWaiting, setIncludeWaiting] = useState(false);
  const request = useLoad<RequestDetail>(`/api/requests/${id}`);
  const matches = useLoad<Matches>(`/api/requests/${id}/matches${includeWaiting ? "?include_ineligible=1" : ""}`);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "warn"; text: string } | null>(null);
  const [busyDonor, setBusyDonor] = useState<number | null>(null);
  const [units, setUnits] = useState<Record<number, string>>({});
  const [date, setDate] = useState("");
  const [editing, setEditing] = useState(false);

  const r = request.data;
  const isOpen = r ? r.status === "Pending" || r.status === "Partially_Fulfilled" : false;
  const isMine = r ? r.hospital_id === me.hospital_id : false;
  const refresh = () => Promise.all([request.reload(), matches.reload()]);

  async function record(donor: Match) {
    setBusyDonor(donor.donor_id);
    setNotice(null);
    try {
      const { data, meta } = await api<{ request: { status: RequestStatus; units_remaining: number } }>("/api/donations", {
        method: "POST",
        body: { donor_id: donor.donor_id, request_id: Number(id), units_donated: Number(units[donor.donor_id] ?? 1), donation_date: date || null },
      });
      const left = data.request.units_remaining;
      setNotice({
        tone: meta.activity_log === "queued" ? "warn" : "success",
        text:
          `Donation recorded for ${donor.name}. ` +
          (left === 0 ? "The request is now fulfilled." : `${left} unit${left === 1 ? "" : "s"} still needed.`) +
          (meta.activity_log === "queued" ? " The activity log entry is queued because MongoDB is not reachable." : ""),
      });
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
      await refresh();
    } finally {
      setBusyDonor(null);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel this request? This cannot be undone.")) return;
    try {
      await api(`/api/requests/${id}/cancel`, { method: "POST", body: {} });
      setNotice({ tone: "success", text: "Request cancelled." });
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    }
  }

  async function removeDonation(d: Donation) {
    if (!window.confirm(`Delete the donation from ${d.donor_name}? The request's progress will be reduced.`)) return;
    try {
      await api(`/api/donations/${d.donation_id}`, { method: "DELETE" });
      setNotice({ tone: "success", text: "Donation deleted." });
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    }
  }

  if (request.error) return <LoadError message={request.error} onRetry={request.reload} />;
  if (!r) return <Loading what="Loading the request" />;

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/requests" className="text-ink-soft hover:text-ink">Blood requests</Link> <span className="text-ink-soft">/ Request #{r.request_id}</span>
      </p>
      <PageHeader
        title={`${r.blood_group_needed} for ${r.recipient_name}`}
        lead={`${r.hospital_name}, ${r.hospital_city}. Raised ${formatDate(r.request_date)}${r.days_waiting > 0 ? ` (${r.days_waiting} day${r.days_waiting === 1 ? "" : "s"} ago)` : ""}.`}
        action={
          isOpen && isMine && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing((v) => !v)}>{editing ? "Close editing" : "Edit request"}</Button>
              <Button variant="danger" onClick={cancel}>Cancel request</Button>
            </div>
          )
        }
      />

      <div className="space-y-6">
        {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}

        <Panel className={`border-l-2 ${URGENCY_BAR[r.urgency_level]}`}>
          <dl className="grid grid-cols-2 items-start gap-x-6 gap-y-4 md:grid-cols-5">
            <div><dt className="mb-1 text-sm text-ink-soft">Needs</dt><dd><BloodGroupTag group={r.blood_group_needed} size="lg" /></dd></div>
            <div><dt className="mb-1 text-sm text-ink-soft">Urgency</dt><dd><UrgencyTag level={r.urgency_level} /></dd></div>
            <div><dt className="mb-1 text-sm text-ink-soft">Status</dt><dd><StatusTag status={r.status} /></dd></div>
            <div><dt className="mb-1 text-sm text-ink-soft">Units donated</dt><dd><UnitMeter required={r.units_required} fulfilled={r.units_fulfilled} /></dd></div>
            <div><dt className="mb-1 text-sm text-ink-soft">Recipient’s own group</dt><dd><BloodGroupTag group={r.recipient_blood_group} /></dd></div>
          </dl>
          {r.notes && <p className="mt-4 border-t border-line-soft pt-3 text-ink-soft">Notes: {r.notes}</p>}
          {!isMine && isOpen && <p className="mt-4 border-t border-line-soft pt-3 text-ink-soft">This request belongs to another hospital. You can see matching donors, but only {r.hospital_name} staff can record donations or change it.</p>}
        </Panel>

        {editing && isOpen && isMine && (
          <EditForm
            request={r}
            onDone={async (message) => {
              setEditing(false);
              setNotice({ tone: "success", text: message });
              await refresh();
            }}
          />
        )}

        {isOpen && (
          <Panel
            title="Matching donors"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-ink-soft">
                  <input type="checkbox" checked={includeWaiting} onChange={(e) => setIncludeWaiting(e.target.checked)} className="h-4 w-4 accent-venous" />
                  Also show donors still in their 90-day waiting period
                </label>
                <Button variant="secondary" busy={matches.loading} onClick={() => void matches.reload()}><RefreshIcon /> Run match again</Button>
              </div>
            }
          >
            {matches.error && <LoadError message={matches.error} onRetry={matches.reload} />}
            {matches.loading && !matches.data && <Loading what="Finding compatible donors" />}
            {matches.data && (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-elevated px-3.5 py-3">
                  <BloodGroupTag group={r.blood_group_needed} />
                  <UrgencyTag level={r.urgency_level} />
                  <span className="text-ink-soft"><ArrowIcon /></span>
                  <span className="text-sm">
                    <strong className="tabular font-semibold">{matches.data.summary.eligible}</strong> eligible donor{matches.data.summary.eligible === 1 ? "" : "s"} for{" "}
                    <strong className="tabular font-semibold">{matches.data.summary.units_remaining}</strong> unit{matches.data.summary.units_remaining === 1 ? "" : "s"} still needed
                  </span>
                </div>
                {matches.data.message && (
                  <div className="mb-4"><Notice tone={matches.data.matches.length === 0 ? "warn" : "info"}>{matches.data.message}</Notice></div>
                )}
                {matches.data.matches.length === 0 ? (
                  <Empty title="No matching donors">
                    {includeWaiting
                      ? "No available donor with a compatible blood group is registered yet."
                      : "Tick the box above to see compatible donors who become eligible soon."}
                  </Empty>
                ) : (
                  <>
                    {isMine && (
                      <div className="mb-3 max-w-xs">
                        <Field label="Donation date for records made below" hint="Leave empty for today">
                          <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
                        </Field>
                      </div>
                    )}
                    <Table head={["Rank", "Donor", "Group", "City", "Last donation", "Eligibility", isMine ? "Record donation" : "Phone"]}>
                      {matches.data.matches.map((m, i) => (
                        <tr key={m.donor_id} className={Number(m.is_eligible) ? "" : "bg-slate-wash/60"}>
                          <td className={Number(m.is_eligible) && i === 0 ? "tabular font-semibold text-venous" : "tabular text-ink-soft"}>{i + 1}</td>
                          <td>
                            <span className="font-medium">{m.name}</span>
                            <span className="block text-sm text-ink-soft tabular">{m.phone}</span>
                          </td>
                          <td>
                            <BloodGroupTag group={m.blood_group} />
                            <span className="mt-1 block"><Pill tone={Number(m.exact_group_match) ? "good" : "neutral"}>{Number(m.exact_group_match) ? "Exact match" : "Compatible"}</Pill></span>
                            {m.offered_help && <span className="mt-1 block"><Pill tone="good">Offered to help</Pill></span>}
                          </td>
                          <td>
                            {m.city}
                            {Number(m.same_city) === 1 && <span className="block text-sm text-teal">Same city</span>}
                          </td>
                          <td>
                            {m.last_donation_date ? (
                              <>
                                {formatDate(m.last_donation_date)}
                                <span className="block text-sm text-ink-soft">{m.days_since_last_donation} days ago</span>
                              </>
                            ) : (
                              <span className="text-ink-soft">None on record</span>
                            )}
                          </td>
                          <td>
                            {Number(m.is_eligible) ? <Pill tone="good">Eligible</Pill> : <Pill tone="warn">From {formatDate(m.next_eligible_date)}</Pill>}
                          </td>
                          <td>
                            {isMine ? (
                              Number(m.is_eligible) ? (
                                <span className="flex items-center gap-2">
                                  <Select
                                    aria-label={`Units from ${m.name}`}
                                    className="w-24"
                                    value={units[m.donor_id] ?? "1"}
                                    onChange={(e) => setUnits((u) => ({ ...u, [m.donor_id]: e.target.value }))}
                                  >
                                    <option value="1">1 unit</option>
                                    {r.units_remaining >= 2 && <option value="2">2 units</option>}
                                  </Select>
                                  <Button variant={i === 0 ? "primary" : "secondary"} busy={busyDonor === m.donor_id} disabled={busyDonor !== null} onClick={() => record(m)}>
                                    Record
                                  </Button>
                                </span>
                              ) : (
                                <span className="text-sm text-ink-soft">Not yet eligible</span>
                              )
                            ) : (
                              <span className="tabular">{m.phone}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </>
                )}
                <p className="mt-4 max-w-[80ch] text-sm text-ink-soft">{DISCLAIMER}</p>
              </>
            )}
          </Panel>
        )}

        <Panel title="Donations for this request">
          {r.donations.length === 0 ? (
            <Empty title="No donations yet">{isOpen ? "Record one from the matching donors above." : "This request was closed without donations."}</Empty>
          ) : (
            <Table head={["Date", "Donor", "Group", "Units", ""]}>
              {r.donations.map((d) => (
                <tr key={d.donation_id}>
                  <td>{formatDate(d.donation_date)}</td>
                  <td className="font-medium">{d.donor_name}</td>
                  <td><BloodGroupTag group={d.donor_blood_group} /></td>
                  <td className="tabular">{d.units_donated}</td>
                  <td className="text-right">
                    {isMine && r.status !== "Cancelled" && (
                      <Button variant="quiet" onClick={() => removeDonation(d)}>Delete</Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>

        <p className="text-sm">
          <Link href={`/activity?request_id=${r.request_id}`} className="text-ink-soft underline hover:text-ink">See this request’s activity history</Link>
        </p>
      </div>
    </>
  );
}

function EditForm({ request, onDone }: { request: RequestDetail; onDone: (message: string) => void }) {
  const [units, setUnits] = useState(String(request.units_required));
  const [urgency, setUrgency] = useState<string>(request.urgency_level);
  const [notes, setNotes] = useState(request.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/requests/${request.request_id}`, { method: "PATCH", body: { units_required: units, urgency_level: urgency, notes } });
      onDone("Request updated.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Edit request">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Units required" hint={`At least ${Math.max(request.units_fulfilled, 1)} (already donated: ${request.units_fulfilled})`}>
            <Input type="number" min={Math.max(request.units_fulfilled, 1)} max={20} value={units} onChange={(e) => setUnits(e.target.value)} />
          </Field>
          <Field label="Urgency">
            <Select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              {URGENCY_LEVELS.map((u) => <option key={u}>{u}</option>)}
            </Select>
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={255} />
          </Field>
        </div>
        <Button type="submit" busy={busy}>Save changes</Button>
      </form>
    </Panel>
  );
}
