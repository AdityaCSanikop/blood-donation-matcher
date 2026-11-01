"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CompatibilityChart } from "@/components/CompatibilityChart";
import { api, ApiFailure, formError } from "@/lib/client";
import { Button, Field, Input, LinkButton, Notice } from "@/components/ui";

const STEPS = [
  { title: "A hospital raises a request", text: "Staff record the blood group, the units needed and how urgent it is." },
  { title: "Urgent requests come first", text: "Open requests are ranked Critical to Low, then by how long they have waited." },
  { title: "The database finds donors", text: "It lists donors with a compatible group who are available and last gave at least 90 days ago." },
  { title: "Staff confirm and record", text: "Qualified staff make the medical decision and record each donation against the request." },
];

/** The sign-in page doubles as the public landing page: it is the page signed-out visitors reach. */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { data } = await api<{ role: string }>("/api/auth/login", { method: "POST", body: { email, password } });
      router.replace(data.role === "DONOR" ? "/me" : "/");
    } catch (err) {
      if (err instanceof ApiFailure) setFields(err.fields);
      setError(formError(err));
      setBusy(false);
    }
  }

  return (
    <main>
      <section className="relative overflow-hidden">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="pointer-events-none absolute -top-24 -right-32 hidden h-[640px] w-[640px] lg:block" fill="none" stroke="var(--color-line-soft)" strokeWidth="0.12">
          <path d="M12 3s6.500 6.600 6.500 11.200A6.500 6.500 0 0 1 12 21a6.500 6.500 0 0 1-6.500-6.800C5.500 9.600 12 3 12 3z" />
          <path d="M12 6s4.300 4.500 4.300 8.100A4.300 4.300 0 0 1 12 18.700a4.300 4.300 0 0 1-4.300-4.600C7.700 10.500 12 6 12 6z" />
        </svg>
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_380px] lg:py-20">
          <div>
            <h1 className="max-w-[14ch] text-4xl leading-[1.08] font-semibold sm:text-6xl">Every Second Counts. Every Donor Matters.</h1>
            <p className="mt-5 max-w-[52ch] text-lg text-ink-soft">
              A small database project that helps hospitals find suitable donors for a blood request, based on compatibility, availability and urgency.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <LinkButton href="#sign-in" variant="primary">Find blood</LinkButton>
              <LinkButton href="/register">Become a donor</LinkButton>
            </div>
          </div>

          <div id="sign-in" className="scroll-mt-6 rounded-lg border border-line bg-surface p-5">
            <h2 className="text-lg font-semibold">Sign in</h2>
            <p className="mt-0.5 mb-4 text-sm text-ink-soft">Hospital staff and registered donors use the same form.</p>
            <form onSubmit={submit} className="space-y-4" noValidate>
              {error && <Notice tone="error">{error}</Notice>}
              <Field label="Email" error={fields.email}>
                <Input type="email" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label="Password" error={fields.password}>
                <Input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              <Button type="submit" busy={busy} className="w-full">
                Sign in
              </Button>
            </form>
            <p className="mt-4 text-sm text-ink-soft">
              Want to donate?{" "}
              <Link href="/register" className="font-medium text-ink underline">
                Register as a donor
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-6 border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold">How matching works</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="tabular text-sm font-medium text-venous">0{i + 1}</span>
                <h3 className="mt-1 font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-ink-soft">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="compatibility" className="scroll-mt-6 border-t border-line">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_2fr]">
          <div>
            <h2 className="text-2xl font-semibold">Who can give to whom</h2>
            <p className="mt-2 text-ink-soft">
              A donor can give when their red cells carry no antigen the recipient lacks. O− can give to every group, and AB+ can receive from every group.
            </p>
            <p className="mt-3 text-sm text-ink-soft">A simplified rule for this project. Cross-matching and medical assessment are always required.</p>
          </div>
          <div className="min-w-0"><CompatibilityChart /></div>
        </div>
      </section>
    </main>
  );
}
