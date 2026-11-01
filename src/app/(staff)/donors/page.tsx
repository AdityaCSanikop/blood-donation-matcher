"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { BloodGroupTag, Button, Empty, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Pill, Select, Table } from "@/components/ui";
import { api, ApiFailure, errorMessage, formError, formatDate, todayIso } from "@/lib/client";
import { BLOOD_GROUPS, type Availability, type BloodGroup } from "@/lib/constants";
import { useDebounced, useLoad } from "@/lib/hooks";

type Donor = {
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
};

export default function DonorsPage() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [ready, setReady] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const search = useDebounced(q);

  const query = new URLSearchParams();
  if (search.trim()) query.set("q", search.trim());
  if (group) query.set("blood_group", group);
  if (ready) query.set("ready", ready);
  const { data, error, loading, reload } = useLoad<Donor[]>(`/api/donors?${query}`);

  async function toggle(d: Donor) {
    setBusyId(d.donor_id);
    const next: Availability = d.availability_status === "Available" ? "Unavailable" : "Available";
    try {
      await api(`/api/donors/${d.donor_id}/availability`, { method: "PATCH", body: { availability_status: next } });
      setNotice({ tone: "success", text: `${d.name} is now marked ${next.toLowerCase()}.` });
      await reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(d: Donor) {
    if (!window.confirm(`Delete donor ${d.name}?`)) return;
    try {
      await api(`/api/donors/${d.donor_id}`, { method: "DELETE" });
      setNotice({ tone: "success", text: `${d.name} deleted.` });
      await reload();
    } catch (err) {
      const text = err instanceof ApiFailure && err.code === "IN_USE" ? `${d.name} has donations or a login on record and cannot be deleted. Mark them unavailable instead.` : errorMessage(err);
      setNotice({ tone: "error", text });
    }
  }

  return (
    <>
      <PageHeader
        title="Donors"
        lead="A donor can give when they are marked available and at least 90 days have passed since their last donation."
        action={!showForm && <Button onClick={() => setShowForm(true)}>Register a donor</Button>}
      />
      {notice && <div className="mb-4"><Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice></div>}
      {showForm && (
        <DonorForm
          onCancel={() => setShowForm(false)}
          onCreated={(name) => {
            setShowForm(false);
            setNotice({ tone: "success", text: `${name} registered.` });
            void reload();
          }}
        />
      )}
      <Panel>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label="Search by name or city">
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Meera or Mysuru" />
            </Field>
          </div>
          <Field label="Blood group">
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Any</option>
              {BLOOD_GROUPS.map((g) => <option key={g}>{g}</option>)}
            </Select>
          </Field>
          <Field label="Can give today">
            <Select value={ready} onChange={(e) => setReady(e.target.value)}>
              <option value="">Everyone</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </Select>
          </Field>
        </div>
        {error && <LoadError message={error} onRetry={reload} />}
        {loading && !data && <Loading what="Loading donors" />}
        {data && data.length === 0 && <Empty title="No donors match">Clear the search or filters, or register a new donor.</Empty>}
        {data && data.length > 0 && (
          <>
            <p className="mb-2 text-sm text-ink-soft" role="status">{data.length} donor{data.length === 1 ? "" : "s"}</p>
            <Table head={["Donor", "Group", "City", "Last donation", "Can give today", "Availability", ""]}>
              {data.map((d) => (
                <tr key={d.donor_id}>
                  <td>
                    <span className="font-medium">{d.name}</span>
                    <span className="block text-sm text-ink-soft tabular">{d.phone}</span>
                  </td>
                  <td><BloodGroupTag group={d.blood_group} /></td>
                  <td>{d.city}</td>
                  <td>
                    {d.last_donation_date ? (
                      <>
                        {formatDate(d.last_donation_date)}
                        <span className="block text-sm text-ink-soft">{d.days_since_last_donation} days ago</span>
                      </>
                    ) : (
                      <span className="text-ink-soft">None on record</span>
                    )}
                  </td>
                  <td>
                    {Number(d.can_donate_now) ? (
                      <Pill tone="good">Yes</Pill>
                    ) : d.availability_status === "Unavailable" ? (
                      <Pill>No, unavailable</Pill>
                    ) : (
                      <Pill tone="warn">From {formatDate(d.next_eligible_date)}</Pill>
                    )}
                  </td>
                  <td>
                    <Button variant="secondary" busy={busyId === d.donor_id} onClick={() => toggle(d)} aria-label={`Mark ${d.name} ${d.availability_status === "Available" ? "unavailable" : "available"}`}>
                      {d.availability_status === "Available" ? "Mark unavailable" : "Mark available"}
                    </Button>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <Link href={`/activity?donor_id=${d.donor_id}`} className="mr-2 text-sm underline">History</Link>
                    <Button variant="quiet" onClick={() => remove(d)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Panel>
    </>
  );
}

const EMPTY = { name: "", blood_group: "", phone: "", city: "", gender: "", dob: "", last_donation_date: "" };

function DonorForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (name: string) => void }) {
  const [form, setForm] = useState(EMPTY);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api("/api/donors", { method: "POST", body: form });
      onCreated(form.name);
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.fields);
      setError(formError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Register a donor" className="mb-6">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Full name" error={fields.name}><Input name="name" value={form.name} onChange={set("name")} /></Field>
          <Field label="Blood group" error={fields.blood_group}>
            <Select name="blood_group" value={form.blood_group} onChange={set("blood_group")}>
              <option value="">Choose…</option>
              {BLOOD_GROUPS.map((g) => <option key={g}>{g}</option>)}
            </Select>
          </Field>
          <Field label="Phone" error={fields.phone} hint="7–14 digits"><Input name="phone" inputMode="tel" value={form.phone} onChange={set("phone")} /></Field>
          <Field label="City" error={fields.city}><Input name="city" value={form.city} onChange={set("city")} /></Field>
          <Field label="Gender (optional)" error={fields.gender}>
            <Select name="gender" value={form.gender} onChange={set("gender")}>
              <option value="">Not recorded</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="Other">Other</option>
            </Select>
          </Field>
          <Field label="Date of birth (optional)" error={fields.dob}><Input type="date" name="dob" max={todayIso()} value={form.dob} onChange={set("dob")} /></Field>
          <Field label="Last donation (optional)" error={fields.last_donation_date} hint="Empty = none on record">
            <Input type="date" name="last_donation_date" max={todayIso()} value={form.last_donation_date} onChange={set("last_donation_date")} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" busy={busy}>Register donor</Button>
          <Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}
