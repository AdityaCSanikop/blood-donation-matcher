"use client";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/AppShell";
import { BloodGroupTag, Button, Empty, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select, Table } from "@/components/ui";
import { api, ApiFailure, errorMessage, formError } from "@/lib/client";
import { BLOOD_GROUPS, type BloodGroup } from "@/lib/constants";
import { useLoad } from "@/lib/hooks";

type Recipient = {
  recipient_id: number;
  name: string;
  blood_group: BloodGroup;
  phone: string | null;
  age: number | null;
  hospital_id: number;
  hospital_name: string;
  request_count: number;
  open_request_count: number;
};

export default function RecipientsPage() {
  const me = useMe();
  const [scope, setScope] = useState("mine");
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { data, error, loading, reload } = useLoad<Recipient[]>(`/api/recipients?scope=${scope}`);

  async function remove(r: Recipient) {
    if (!window.confirm(`Delete recipient ${r.name}?`)) return;
    try {
      await api(`/api/recipients/${r.recipient_id}`, { method: "DELETE" });
      setNotice({ tone: "success", text: `${r.name} deleted.` });
      await reload();
    } catch (err) {
      const text = err instanceof ApiFailure && err.code === "IN_USE" ? `${r.name} has blood requests on record and cannot be deleted.` : errorMessage(err);
      setNotice({ tone: "error", text });
    }
  }

  return (
    <>
      <PageHeader
        title="Recipients"
        lead={`Patients who need blood. New recipients are registered at ${me.hospital_name ?? "your hospital"}.`}
        action={!showForm && <Button onClick={() => setShowForm(true)}>Register a recipient</Button>}
      />
      {notice && <div className="mb-4"><Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice></div>}
      {showForm && (
        <RecipientForm
          onCancel={() => setShowForm(false)}
          onCreated={(name) => {
            setShowForm(false);
            setNotice({ tone: "success", text: `${name} registered.` });
            void reload();
          }}
        />
      )}
      <Panel>
        <div className="mb-4 max-w-xs">
          <Field label="Show">
            <Select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="mine">My hospital’s recipients</option>
              <option value="all">All hospitals</option>
            </Select>
          </Field>
        </div>
        {error && <LoadError message={error} onRetry={reload} />}
        {loading && !data && <Loading what="Loading recipients" />}
        {data && data.length === 0 && <Empty title="No recipients yet">Register a recipient to raise a blood request for them.</Empty>}
        {data && data.length > 0 && (
          <Table head={["Recipient", "Group", "Age", "Hospital", "Requests", ""]}>
            {data.map((r) => (
              <tr key={r.recipient_id}>
                <td>
                  <span className="font-medium">{r.name}</span>
                  {r.phone && <span className="block text-sm text-ink-soft tabular">{r.phone}</span>}
                </td>
                <td><BloodGroupTag group={r.blood_group} /></td>
                <td className="tabular">{r.age ?? "—"}</td>
                <td>{r.hospital_name}</td>
                <td className="tabular">
                  {r.request_count}
                  {r.open_request_count > 0 && <span className="text-ink-soft"> ({r.open_request_count} open)</span>}
                </td>
                <td className="text-right">
                  {r.hospital_id === me.hospital_id && <Button variant="quiet" onClick={() => remove(r)}>Delete</Button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

function RecipientForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (name: string) => void }) {
  const [form, setForm] = useState({ name: "", blood_group: "", phone: "", age: "" });
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
      await api("/api/recipients", { method: "POST", body: form });
      onCreated(form.name);
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.fields);
      setError(formError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Register a recipient" className="mb-6">
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
          <Field label="Age (optional)" error={fields.age}><Input name="age" type="number" min={1} max={120} value={form.age} onChange={set("age")} /></Field>
          <Field label="Phone (optional)" error={fields.phone}><Input name="phone" inputMode="tel" value={form.phone} onChange={set("phone")} /></Field>
        </div>
        <div className="flex gap-2">
          <Button type="submit" busy={busy}>Register recipient</Button>
          <Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Panel>
  );
}
