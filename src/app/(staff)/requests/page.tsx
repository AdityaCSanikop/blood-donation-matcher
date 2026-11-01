"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/AppShell";
import { BloodGroupTag, Button, Empty, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, StatusTag, Table, UnitMeter, UrgencyTag } from "@/components/ui";
import { api, ApiFailure, formError, formatDate } from "@/lib/client";
import { BLOOD_GROUPS, URGENCY_LEVELS, type BloodGroup, type RequestStatus, type UrgencyLevel } from "@/lib/constants";
import { useLoad } from "@/lib/hooks";

type RequestRow = {
  request_id: number;
  recipient_name: string;
  hospital_id: number;
  hospital_name: string;
  blood_group_needed: BloodGroup;
  units_required: number;
  units_fulfilled: number;
  urgency_level: UrgencyLevel;
  request_date: string;
  days_waiting: number;
  status: RequestStatus;
  eligible_donor_count?: number;
};
type Recipient = { recipient_id: number; name: string; blood_group: BloodGroup };

export default function RequestsPage() {
  const me = useMe();
  const [status, setStatus] = useState("open");
  const [urgency, setUrgency] = useState("");
  const [group, setGroup] = useState("");
  const [mine, setMine] = useState(false);
  // Rendered only in the browser (inside AppShell), so reading the URL here is safe.
  const [showForm, setShowForm] = useState(() => new URLSearchParams(window.location.search).get("new") === "1");
  const [notice, setNotice] = useState<string | null>(null);

  const query = new URLSearchParams({ status });
  if (urgency) query.set("urgency", urgency);
  if (group) query.set("blood_group", group);
  if (mine && me.hospital_id) query.set("hospital_id", String(me.hospital_id));
  const { data, error, loading, reload } = useLoad<RequestRow[]>(`/api/requests?${query}`);

  return (
    <>
      <PageHeader
        title="Blood requests"
        lead="Sorted by urgency, then by how long the request has been waiting."
        action={!showForm && <Button onClick={() => setShowForm(true)}>Raise a blood request</Button>}
      />
      {notice && (
        <div className="mb-4">
          <Notice tone="success" onDismiss={() => setNotice(null)}>{notice}</Notice>
        </div>
      )}
      {showForm && (
        <NewRequestForm
          onCancel={() => setShowForm(false)}
          onCreated={(id) => {
            setShowForm(false);
            setNotice(`Request #${id} raised.`);
            void reload();
          }}
        />
      )}

      <Panel>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="open">Open (pending or partial)</option>
              <option value="all">All</option>
              <option value="Pending">Pending</option>
              <option value="Partially_Fulfilled">Partially fulfilled</option>
              <option value="Fulfilled">Fulfilled</option>
              <option value="Cancelled">Cancelled</option>
            </Select>
          </Field>
          <Field label="Urgency">
            <Select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              <option value="">Any</option>
              {URGENCY_LEVELS.map((u) => <option key={u}>{u}</option>)}
            </Select>
          </Field>
          <Field label="Blood group">
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Any</option>
              {BLOOD_GROUPS.map((g) => <option key={g}>{g}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 pb-2.5 text-[15px]">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 accent-venous" />
            Only my hospital
          </label>
        </div>

        {error && <LoadError message={error} onRetry={reload} />}
        {loading && !data && <Loading what="Loading requests" />}
        {data && data.length === 0 && (
          <Empty title="No requests match these filters">Change the filters, or raise a new request for one of your recipients.</Empty>
        )}
        {data && data.length > 0 && (
          <Table head={["Urgency", "Needs", "Recipient", "Hospital", "Units", "Raised", "Status", ""]}>
            {data.map((r) => (
              <tr key={r.request_id}>
                <td><UrgencyTag level={r.urgency_level} /></td>
                <td><BloodGroupTag group={r.blood_group_needed} /></td>
                <td className="font-medium">{r.recipient_name}</td>
                <td>{r.hospital_name}</td>
                <td><UnitMeter required={r.units_required} fulfilled={r.units_fulfilled} /></td>
                <td className="whitespace-nowrap">{formatDate(r.request_date)}</td>
                <td><StatusTag status={r.status} /></td>
                <td className="text-right">
                  <Link href={`/requests/${r.request_id}`} className="font-medium whitespace-nowrap text-venous hover:underline">
                    {r.status === "Pending" || r.status === "Partially_Fulfilled" ? "Find donors" : "View"}
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function NewRequestForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: number) => void }) {
  const me = useMe();
  const recipients = useLoad<Recipient[]>("/api/recipients");
  const [form, setForm] = useState({ recipient_id: "", blood_group_needed: "", units_required: "1", urgency_level: "Medium", notes: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const chosen = recipients.data?.find((r) => String(r.recipient_id) === form.recipient_id);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const body = { ...form, blood_group_needed: form.blood_group_needed || undefined };
      const { data } = await api<{ request_id: number }>("/api/requests", { method: "POST", body });
      onCreated(data.request_id);
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.fields);
      setError(formError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={`Raise a blood request at ${me.hospital_name ?? "your hospital"}`} className="mb-6">
      {recipients.loading && <Loading what="Loading recipients" />}
      {recipients.data && recipients.data.length === 0 && (
        <Empty title="Register a recipient first">
          A request is always raised for a recipient at your hospital. <Link href="/recipients" className="underline">Go to recipients</Link>
        </Empty>
      )}
      {recipients.data && recipients.data.length > 0 && (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Recipient" error={fields.recipient_id}>
              <Select name="recipient_id" value={form.recipient_id} onChange={set("recipient_id")}>
                <option value="">Choose a recipient…</option>
                {recipients.data.map((r) => (
                  <option key={r.recipient_id} value={r.recipient_id}>
                    {r.name} ({r.blood_group})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Blood group needed" error={fields.blood_group_needed} hint="Must be a group the recipient can receive">
              <Select name="blood_group_needed" value={form.blood_group_needed} onChange={set("blood_group_needed")}>
                <option value="">{chosen ? `Same as recipient (${chosen.blood_group})` : "Same as recipient"}</option>
                {BLOOD_GROUPS.map((g) => <option key={g}>{g}</option>)}
              </Select>
            </Field>
            <Field label="Units required" error={fields.units_required} hint="1 to 20">
              <Input name="units_required" type="number" min={1} max={20} value={form.units_required} onChange={set("units_required")} />
            </Field>
            <Field label="Urgency" error={fields.urgency_level}>
              <Select name="urgency_level" value={form.urgency_level} onChange={set("urgency_level")}>
                {URGENCY_LEVELS.map((u) => <option key={u}>{u}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Notes (optional)" error={fields.notes}>
            <Input name="notes" value={form.notes} onChange={set("notes")} maxLength={255} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" busy={busy}>Raise request</Button>
            <Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
