"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiFailure, formError, todayIso } from "@/lib/client";
import { BLOOD_GROUPS } from "@/lib/constants";
import { Button, Field, Input, Notice, Select } from "@/components/ui";

const EMPTY = { name: "", email: "", password: "", blood_group: "", phone: "", city: "", gender: "", dob: "", last_donation_date: "" };

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api("/api/auth/register", { method: "POST", body: form });
      router.replace("/me");
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.fields);
      setError(formError(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold">Register as a donor</h1>
      <p className="mt-1 mb-6 text-ink-soft">Hospitals will see your blood group, city and phone number when you could help a patient.</p>
      <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-surface p-5" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Full name" error={fields.name}>
          <Input name="name" value={form.name} onChange={set("name")} autoComplete="name" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Blood group" error={fields.blood_group}>
            <Select name="blood_group" value={form.blood_group} onChange={set("blood_group")}>
              <option value="">Choose…</option>
              {BLOOD_GROUPS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </Select>
          </Field>
          <Field label="City" error={fields.city}>
            <Input name="city" value={form.city} onChange={set("city")} />
          </Field>
          <Field label="Phone" error={fields.phone} hint="7–14 digits">
            <Input name="phone" inputMode="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" />
          </Field>
          <Field label="Gender (optional)" error={fields.gender}>
            <Select name="gender" value={form.gender} onChange={set("gender")}>
              <option value="">Prefer not to say</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="Other">Other</option>
            </Select>
          </Field>
          <Field label="Date of birth (optional)" error={fields.dob}>
            <Input type="date" name="dob" max={todayIso()} value={form.dob} onChange={set("dob")} />
          </Field>
          <Field label="Last donation (optional)" error={fields.last_donation_date} hint="Leave empty if you have never donated">
            <Input type="date" name="last_donation_date" max={todayIso()} value={form.last_donation_date} onChange={set("last_donation_date")} />
          </Field>
        </div>
        <Field label="Email" error={fields.email}>
          <Input type="email" name="email" value={form.email} onChange={set("email")} autoComplete="username" />
        </Field>
        <Field label="Password" error={fields.password} hint="At least 8 characters">
          <Input type="password" name="password" value={form.password} onChange={set("password")} autoComplete="new-password" />
        </Field>
        <Button type="submit" busy={busy} className="w-full">
          Create donor account
        </Button>
      </form>
      <p className="mt-6 text-ink-soft">
        Already registered?{" "}
        <Link href="/login#sign-in" className="font-medium text-ink underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
