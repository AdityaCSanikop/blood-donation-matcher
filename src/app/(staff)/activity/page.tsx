"use client";
import { useState } from "react";
import { Button, Empty, Field, Input, Loading, LoadError, Notice, PageHeader, Panel, Select } from "@/components/ui";
import { ActivityList, type ActivityItem } from "@/components/ActivityList";
import { api, errorMessage } from "@/lib/client";
import { useLoad } from "@/lib/hooks";

type Stats = {
  granularity: "day" | "week";
  timezone: string;
  total: number;
  by_period: { period: string; total: number; actions: { action: string; count: number }[] }[];
  by_action: { action: string; count: number }[];
  by_entity_type: { entity_type: string; count: number }[];
};

const ACTIONS = [
  "request_created",
  "request_status_changed",
  "request_updated",
  "donation_recorded",
  "donation_deleted",
  "donor_registered",
  "donor_availability_changed",
  "donor_profile_updated",
  "recipient_registered",
  "hospital_registered",
];
const label = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export default function ActivityPage() {
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  // Rendered only in the browser (inside AppShell), so reading the URL here is safe.
  const [donorId, setDonorId] = useState(() => new URLSearchParams(window.location.search).get("donor_id") ?? "");
  const [requestId, setRequestId] = useState(() => new URLSearchParams(window.location.search).get("request_id") ?? "");
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const [limit, setLimit] = useState(30);
  const [reconcile, setReconcile] = useState<{ tone: "success" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const query = new URLSearchParams({ limit: String(limit) });
  if (entityType) query.set("entity_type", entityType);
  if (action) query.set("action", action);
  if (Number(donorId) > 0) query.set("donor_id", donorId);
  if (Number(requestId) > 0) query.set("request_id", requestId);

  const feed = useLoad<ActivityItem[]>(`/api/activity?${query}`);
  const stats = useLoad<Stats>(`/api/activity/stats?granularity=${granularity}&days=${granularity === "week" ? 84 : 14}`);
  const pending = Number(feed.meta.pending_delivery ?? 0);
  const total = Number(feed.meta.total ?? 0);
  const max = Math.max(1, ...(stats.data?.by_period.map((p) => p.total) ?? [1]));

  async function retry() {
    setBusy(true);
    try {
      const { data } = await api<{ delivered: number; pending: number; error: string | null }>("/api/activity/reconcile", { method: "POST" });
      setReconcile(
        data.pending === 0
          ? { tone: "success", text: `${data.delivered} entr${data.delivered === 1 ? "y" : "ies"} copied to MongoDB. Nothing is waiting.` }
          : { tone: "warn", text: `${data.delivered} copied, ${data.pending} still waiting. MongoDB said: ${data.error ?? "unknown error"}` },
      );
      await Promise.all([feed.reload(), stats.reload()]);
    } catch (err) {
      setReconcile({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Activity log" lead="Every change to donors, requests and donations, stored as documents in MongoDB." />
      <div className="space-y-6">
        {reconcile && <Notice tone={reconcile.tone} onDismiss={() => setReconcile(null)}>{reconcile.text}</Notice>}
        {pending > 0 && (
          <Notice tone="warn">
            {pending} entr{pending === 1 ? "y is" : "ies are"} saved in MySQL but not yet copied to MongoDB.{" "}
            <Button variant="secondary" busy={busy} onClick={retry} className="ml-2">Copy them now</Button>
          </Notice>
        )}

        <Panel
          title={granularity === "day" ? "Events per day, last 14 days" : "Events per week, last 12 weeks"}
          action={
            <div className="flex gap-1" role="group" aria-label="Group by">
              <Button variant={granularity === "day" ? "primary" : "secondary"} onClick={() => setGranularity("day")} aria-pressed={granularity === "day"}>By day</Button>
              <Button variant={granularity === "week" ? "primary" : "secondary"} onClick={() => setGranularity("week")} aria-pressed={granularity === "week"}>By week</Button>
            </div>
          }
        >
          {stats.error && <LoadError message={stats.error} onRetry={stats.reload} />}
          {stats.loading && !stats.data && <Loading what="Calculating statistics" />}
          {stats.data && stats.data.total === 0 && <Empty title="No activity in this period">Statistics appear once something is recorded.</Empty>}
          {stats.data && stats.data.total > 0 && (
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <table className="w-full text-left">
                <caption className="sr-only">Number of events per {granularity}</caption>
                <tbody>
                  {stats.data.by_period.map((p) => (
                    <tr key={p.period}>
                      <th scope="row" className="tabular w-28 py-1 pr-3 text-sm font-medium whitespace-nowrap">{p.period}</th>
                      <td className="py-1">
                        <span className="flex items-center gap-2" title={p.actions.map((a) => `${label(a.action)}: ${a.count}`).join("\n")}>
                          <span className="block h-4 rounded-[2px] bg-venous-dark" style={{ width: `${Math.max((p.total / max) * 100, 1.5)}%` }} />
                          <span className="tabular text-sm">{p.total}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                <h3 className="mb-2 text-base font-semibold">By action ({stats.data.total} events)</h3>
                <ul className="space-y-1 text-[15px]">
                  {stats.data.by_action.map((a) => (
                    <li key={a.action} className="flex justify-between gap-4 border-b border-line-soft py-1">
                      <span>{label(a.action)}</span>
                      <span className="tabular font-medium">{a.count}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-ink-soft">Days and weeks are counted in UTC{stats.data.timezone}.</p>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="History">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="About">
              <Select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                <option value="">Everything</option>
                <option value="request">Requests</option>
                <option value="donation">Donations</option>
                <option value="donor">Donors</option>
                <option value="recipient">Recipients</option>
                <option value="hospital">Hospitals</option>
              </Select>
            </Field>
            <Field label="Action">
              <Select value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="">Any</option>
                {ACTIONS.map((a) => <option key={a} value={a}>{label(a)}</option>)}
              </Select>
            </Field>
            <Field label="Donor ID">
              <Input className="w-28" inputMode="numeric" value={donorId} onChange={(e) => setDonorId(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Request ID">
              <Input className="w-28" inputMode="numeric" value={requestId} onChange={(e) => setRequestId(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          {feed.error && <LoadError message={feed.error} onRetry={feed.reload} />}
          {feed.loading && !feed.data && <Loading what="Loading history" />}
          {feed.data && feed.data.length === 0 && <Empty title="No activity matches">Change the filters to see more.</Empty>}
          {feed.data && feed.data.length > 0 && (
            <>
              <ActivityList items={feed.data} />
              <p className="mt-3 flex items-center gap-3 text-sm text-ink-soft">
                Showing {feed.data.length} of {total}.
                {feed.data.length < total && <Button variant="secondary" onClick={() => setLimit((l) => Math.min(l + 30, 200))}>Show more</Button>}
              </p>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
