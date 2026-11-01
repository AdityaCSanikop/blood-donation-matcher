"use client";
import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import type { BloodGroup, RequestStatus, UrgencyLevel } from "@/lib/constants";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ------------------------------------------------------------------ tags

/** Blood group as a compact mark: the same chip everywhere, large in the matcher. */
export function BloodGroupTag({ group, size = "md" }: { group: BloodGroup | string; size?: "md" | "lg" }) {
  const abo = group.replace(/[+-]$/, "");
  const negative = group.endsWith("-");
  return (
    <span
      className={cx(
        "inline-flex w-fit items-center justify-center rounded-md border border-line bg-elevated font-semibold leading-none align-middle tabular",
        size === "lg" ? "h-12 min-w-14 px-3 text-2xl" : "h-7 min-w-10 px-2 text-sm",
      )}
      aria-label={`Blood group ${abo} ${negative ? "negative" : "positive"}`}
    >
      {abo}
      <span className={negative ? "text-venous" : "text-ink-soft"}>{negative ? "−" : "+"}</span>
    </span>
  );
}

const URGENCY_STYLE: Record<UrgencyLevel, string> = {
  Critical: "bg-venous text-white",
  High: "bg-amber-wash text-amber",
  Medium: "bg-elevated text-ink",
  Low: "bg-elevated text-ink-soft",
};
/** A thin rail on the left of a row; the colour alone never carries the meaning. */
export const URGENCY_BAR: Record<UrgencyLevel, string> = {
  Critical: "border-l-venous border-l-2",
  High: "border-l-amber border-l-2",
  Medium: "border-l-ink-soft border-l-2",
  Low: "border-l-line border-l-2",
};

export function UrgencyTag({ level }: { level: UrgencyLevel }) {
  return <span className={cx("inline-block w-fit rounded-md px-2 py-0.5 text-[13px] font-medium", URGENCY_STYLE[level])}>{level}</span>;
}

const STATUS_STYLE: Record<RequestStatus, string> = {
  Pending: "text-ink",
  Partially_Fulfilled: "text-amber",
  Fulfilled: "text-teal",
  Cancelled: "text-ink-soft line-through",
};
const STATUS_DOT: Record<RequestStatus, string> = {
  Pending: "bg-ink-soft",
  Partially_Fulfilled: "bg-amber",
  Fulfilled: "bg-teal",
  Cancelled: "bg-line",
};
export function StatusTag({ status }: { status: RequestStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium">
      <span aria-hidden="true" className={cx("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      <span className={STATUS_STYLE[status]}>{status.replace("_", " ")}</span>
    </span>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: "good" | "warn" | "bad" | "neutral"; children: ReactNode }) {
  const tones = {
    good: "bg-teal-wash text-teal",
    warn: "bg-amber-wash text-amber",
    bad: "bg-venous-wash text-venous",
    neutral: "bg-elevated text-ink-soft",
  };
  return <span className={cx("inline-block rounded-md px-2 py-0.5 text-[13px] font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
}

/** One block per unit of blood: filled = donated, outlined = still needed. */
export function UnitMeter({ required, fulfilled }: { required: number; fulfilled: number }) {
  return (
    <span className="inline-flex items-center gap-2 align-middle" aria-label={`${fulfilled} of ${required} units donated`}>
      <span className="inline-flex gap-[3px]" aria-hidden="true">
        {Array.from({ length: required }, (_, i) => (
          <span key={i} className={cx("h-3.5 w-1.5 rounded-[2px]", i < fulfilled ? "bg-venous" : "bg-ink-soft/35")} />
        ))}
      </span>
      <span className="tabular text-sm text-ink-soft">
        {fulfilled}/{required}
      </span>
    </span>
  );
}

// --------------------------------------------------------------- controls

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "quiet"; busy?: boolean };
const BUTTON_BASE = "inline-flex items-center justify-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors duration-150";
const BUTTON_STYLE = {
  primary: "bg-venous text-white hover:bg-venous-dark border-transparent",
  secondary: "bg-elevated text-ink hover:border-ink-soft border-line",
  danger: "bg-transparent text-venous hover:bg-venous-wash border-venous-dark",
  quiet: "bg-transparent text-ink-soft hover:text-ink hover:bg-elevated border-transparent",
};
export function Button({ variant = "primary", busy, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button {...rest} disabled={disabled || busy} className={cx(BUTTON_BASE, "disabled:cursor-not-allowed disabled:opacity-55", BUTTON_STYLE[variant], className)}>
      {busy ? "Working…" : children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary", className }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link href={href} className={cx(BUTTON_BASE, BUTTON_STYLE[variant], className)}>
      {children}
    </Link>
  );
}

const FIELD = "w-full rounded-md border border-line bg-elevated px-3 py-2 text-[15px] text-ink transition-colors duration-150 placeholder:text-ink-soft/60 hover:border-ink-soft/50 focus:border-ink-soft";

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-sm text-ink-soft">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-sm font-medium text-venous">
          {error}
        </span>
      )}
    </label>
  );
}
export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cx(FIELD, props.className)} />;
export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={cx(FIELD, "pr-8", props.className)} />;
export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} className={cx(FIELD, props.className)} />;

// ---------------------------------------------------------------- layout

export function PageHeader({ title, lead, action }: { title: string; lead?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {lead && <p className="mt-1 max-w-[68ch] text-ink-soft">{lead}</p>}
      </div>
      {action}
    </header>
  );
}

export function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("min-w-0 rounded-lg border border-line bg-surface", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Notice({ tone, children, onDismiss }: { tone: "success" | "error" | "info" | "warn"; children: ReactNode; onDismiss?: () => void }) {
  const tones = {
    success: "bg-teal-wash text-teal",
    error: "bg-venous-wash text-venous",
    warn: "bg-amber-wash text-amber",
    info: "bg-elevated text-ink",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("flex items-start justify-between gap-3 rounded-md px-3.5 py-2.5 text-sm font-medium", tones[tone])}>
      <div>{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 text-sm underline">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return (
    <p role="status" className="py-8 text-center text-ink-soft">
      {what}…
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-[52ch] text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice tone="error">
      {message}{" "}
      <button type="button" className="underline" onClick={onRetry}>
        Try again
      </button>
    </Notice>
  );
}

export function Table({ head, children, compact }: { head: ReactNode[]; children: ReactNode; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx("w-full border-collapse text-left text-sm", compact ? "min-w-[330px]" : "min-w-[640px]")}>
        <thead>
          <tr className="border-b border-line text-[13px] text-ink-soft">
            {head.map((h, i) => (
              <th key={i} scope="col" className={cx("px-3 py-2 font-medium", !compact && "whitespace-nowrap")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line-soft [&>tr]:transition-colors [&>tr:hover]:bg-elevated/50 [&>tr:last-child]:border-0 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle">{children}</tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: string; tone?: "bad" }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={cx("tabular mt-1 text-3xl font-semibold leading-tight", tone === "bad" && "text-venous")}>{value}</p>
      {note && <p className="mt-0.5 text-sm text-ink-soft">{note}</p>}
    </div>
  );
}

export { cx };
