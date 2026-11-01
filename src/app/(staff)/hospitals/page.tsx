"use client";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/AppShell";
import { Button, Empty, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Pill, Table } from "@/components/ui";
import { api, ApiFailure, errorMessage, formError } from "@/lib/client";
import { useDebounced, useLoad } from "@/lib/hooks";

type Hospital = {
  hospital_id: number;
  name: string;
  address: string | null;
  city: string;
  phone: string;
  donation_count: number;
  units_collected: number;
  open_requests: number;
  units_outstanding: number;
};

export default function HospitalsPage() {
  const me = useMe();
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const search = useDebounced(q);
  const { data, error, loading, reload } = useLoad<Hospital[]>(`/api/hospitals${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`);

  async function remove(h: Hospital) {
    if (!window.confirm(`Delete ${h.name}?`)) return;
    try {
      await api(`/api/hospitals/${h.hospital_id}`, { method: "DELETE" });
      setNotice({ tone: "success", text: `${h.name} deleted.` });
      await reload();
    } catch (err) {
      const text = err instanceof ApiFailure && err.code === "IN_USE" ? `${h.name} still has staff, recipients, requests or donations and cannot be deleted.` : errorMessage(err);
      setNotice({ tone: "error", text });
    }
  }

  return (
    <>
      <PageHeader
        title="Hospitals"
        lead="Hospitals and blood banks on the network, with what each has collected and still needs."
        action={!showForm && <Button onClick={() => setShowForm(true)}>Register a hospital</Button>}
      />
      {notice && <div className="mb-4"><Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice></div>}
      {showForm && (
        <HospitalForm
          onCancel={() => setShowForm(false)}
          onCreated={(name) => {
            setShowForm(false);
            setNotice({ tone: "success", text: `${name} registered.` });
            void reload();
          }}
        />
      )}
      <Panel>
        <div className="mb-4 max-w-sm">
          <Field label="Search by name or city">
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
        </div>
        {error && <LoadError message={error} onRetry={reload} />}
        {loading && !data && <Loading what="Loading hospitals" />}
        {data && data.length === 0 && <Empty title="No hospitals match">Clear the search, or register a hospital.</Empty>}
        {data && data.length > 0 && (
          <Table head={["Hospital", "City", "Phone", "Donations", "Units collected", "Open requests", ""]}>
            {data.map((h) => (
              <tr key={h.hospital_id}>
                <td>
                  <span className="font-medium">{h.name}</span> {h.hospital_id === me.hospital_id && <Pill tone="good">Your hospital</Pill>}
                  {h.address && <span className="block text-sm text-ink-soft">{h.address}</span>}
                </td>
                <td>{h.city}</td>
                <td className="tabular">{h.phone}</td>
                <td className="tabular">{h.donation_count}</td>
                <td className="tabular">{h.units_collected}</td>
                <td className="tabular">
                  {h.open_requests}
                  {h.units_outstanding > 0 && <span className="text-ink-soft"> ({h.units_outstanding} units)</span>}
                </td>
                <td className="text-right">{h.hospital_id !== me.hospital_id && <Button variant="quiet" onClick={() => remove(h)}>Delete</Button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function HospitalForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (name: string) => void }) {
  const [form, setForm] = useState({ name: "", address: "", city: "", phone: "" });
  const [staff, setStaff] = useState({ display_name: "", email: "", password: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setS = (key: keyof typeof staff) => (e: { target: { value: string } }) => setStaff((f) => ({ ...f, [key]: e.target.value }));
  const withStaff = Boolean(staff.display_name || staff.email || staff.password);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api("/api/hospitals", { method: "POST", body: withStaff ? { ...form, first_staff: staff } : form });
      onCreated(form.name);
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.fields);
      setError(formError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Register a hospital" className="mb-6">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Hospital name" error={fields.name}><Input name="name" value={form.name} onChange={set("name")} /></Field>
          <Field label="City" error={fields.city}><Input name="city" value={form.city} onChange={set("city")} /></Field>
          <Field label="Phone" error={fields.phone} hint="7–14 digits"><Input name="phone" inputMode="tel" value={form.phone} onChange={set("phone")} /></Field>
          <Field label="Address (optional)" error={fields.address}><Input name="address" value={form.address} onChange={set("address")} /></Field>
        </div>
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-medium">First staff login for this hospital (optional)</legend>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Staff name" error={fields["first_staff.display_name"]}><Input name="staff_name" value={staff.display_name} onChange={setS("display_name")} /></Field>
            <Field label="Staff email" error={fields["first_staff.email"]}><Input name="staff_email" type="email" value={staff.email} onChange={setS("email")} autoComplete="off" /></Field>
            <Field label="Temporary password" error={fields["first_staff.password"]} hint="At least 8 characters">
              <Input name="staff_password" type="password" value={staff.password} onChange={setS("password")} autoComplete="new-password" />
            </Field>
          </div>
        </fieldset>
        <div className="flex gap-2">
          <Button type="submit" busy={busy}>Register hospital</Button>
          <Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}
