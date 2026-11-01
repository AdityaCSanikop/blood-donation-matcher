"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/AppShell";
import { BloodGroupTag, Button, Empty, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, Table } from "@/components/ui";
import { api, ApiFailure, errorMessage, formError, formatDate, todayIso } from "@/lib/client";
import type { BloodGroup } from "@/lib/constants";
import { useLoad } from "@/lib/hooks";

type Donation = {
  donation_id: number;
  donation_date: string;
  units_donated: number;
  donor_name: string;
  donor_blood_group: BloodGroup;
  hospital_id: number;
  hospital_name: string;
  request_id: number | null;
  recipient_name: string | null;
};
type Donor = { donor_id: number; name: string; blood_group: BloodGroup; city: string };

export default function DonationsPage() {
  const me = useMe();
  const [scope, setScope] = useState("mine");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { data, error, loading, reload } = useLoad<Donation[]>(`/api/donations?scope=${scope}`);

  async function remove(d: Donation) {
    if (!window.confirm(`Delete the donation from ${d.donor_name} on ${formatDate(d.donation_date)}?`)) return;
    try {
      await api(`/api/donations/${d.donation_id}`, { method: "DELETE" });
      setNotice({ tone: "success", text: "Donation deleted." });
      await reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    }
  }

  return (
    <>
      <PageHeader
        title="Donations"
        lead="To record a donation for a request, open the request and pick a matching donor. Use the button for a walk-in donation with no request."
        action={!showForm && <Button onClick={() => setShowForm(true)}>Record a walk-in donation</Button>}
      />
      {notice && <div className="mb-4"><Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice></div>}
      {showForm && (
        <WalkInForm
          onCancel={() => setShowForm(false)}
          onCreated={(name) => {
            setShowForm(false);
            setNotice({ tone: "success", text: `Donation recorded for ${name}.` });
            void reload();
          }}
        />
      )}
      <Panel>
        <div className="mb-4 max-w-xs">
          <Field label="Show">
            <Select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="mine">Donations at my hospital</option>
              <option value="all">All hospitals</option>
            </Select>
          </Field>
        </div>
        {error && <LoadError message={error} onRetry={reload} />}
        {loading && !data && <Loading what="Loading donations" />}
        {data && data.length === 0 && <Empty title="No donations recorded yet">Donations appear here as soon as they are recorded.</Empty>}
        {data && data.length > 0 && (
          <Table head={["Date", "Donor", "Group", "Units", "Hospital", "For", ""]}>
            {data.map((d) => (
              <tr key={d.donation_id}>
                <td className="whitespace-nowrap">{formatDate(d.donation_date)}</td>
                <td className="font-medium">{d.donor_name}</td>
                <td><BloodGroupTag group={d.donor_blood_group} /></td>
                <td className="tabular">{d.units_donated}</td>
                <td>{d.hospital_name}</td>
                <td>
                  {d.request_id ? (
                    <Link href={`/requests/${d.request_id}`} className="underline">Request #{d.request_id}{d.recipient_name ? `, ${d.recipient_name}` : ""}</Link>
                  ) : (
                    <span className="text-ink-soft">Walk-in</span>
                  )}
                </td>
                <td className="text-right">{d.hospital_id === me.hospital_id && <Button variant="quiet" onClick={() => remove(d)}>Delete</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function WalkInForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (name: string) => void }) {
  const me = useMe();
  const donors = useLoad<Donor[]>("/api/donors?ready=yes");
  const [form, setForm] = useState({ donor_id: "", units_donated: "1", donation_date: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api("/api/donations", { method: "POST", body: { ...form, request_id: null } });
      onCreated(donors.data?.find((d) => String(d.donor_id) === form.donor_id)?.name ?? "the donor");
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.fields);
      setError(formError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={`Record a walk-in donation at ${me.hospital_name ?? "your hospital"}`} className="mb-6">
      {donors.loading && <Loading what="Loading eligible donors" />}
      {donors.data && donors.data.length === 0 && <Empty title="No donor can give today">Every registered donor is unavailable or inside the 90-day interval.</Empty>}
      {donors.data && donors.data.length > 0 && (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Donor" error={fields.donor_id} hint="Only donors who can give today are listed">
              <Select name="donor_id" value={form.donor_id} onChange={set("donor_id")}>
                <option value="">Choose a donor…</option>
                {donors.data.map((d) => (
                  <option key={d.donor_id} value={d.donor_id}>{d.name} ({d.blood_group}), {d.city}</option>
                ))}
              </Select>
            </Field>
            <Field label="Units" error={fields.units_donated}>
              <Select name="units_donated" value={form.units_donated} onChange={set("units_donated")}>
                <option value="1">1 unit</option>
                <option value="2">2 units</option>
              </Select>
            </Field>
            <Field label="Donation date" error={fields.donation_date} hint="Leave empty for today">
              <Input type="date" name="donation_date" max={todayIso()} value={form.donation_date} onChange={set("donation_date")} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" busy={busy}>Record donation</Button>
            <Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
