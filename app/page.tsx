import { listSubscriptions, lastSync } from "@/lib/queries";
import { fmtCents, fmtDate, fmtRelative } from "@/lib/format";
import SubscriptionRow from "./components/SubscriptionRow";
import SyncButton from "./components/SyncButton";
import SeedButton from "./components/SeedButton";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; hidden?: string }>;
}) {
  const sp = await searchParams;
  const subs = listSubscriptions({
    status: sp.status,
    includeHidden: sp.hidden === "1",
  });
  const sync = lastSync();

  const grouped = {
    review: subs.filter((s) => s.status === "review"),
    needs_cancellation: subs.filter((s) => s.status === "needs_cancellation"),
    active: subs.filter((s) => s.status === "active"),
    canceled: subs.filter((s) => s.status === "canceled"),
    other: subs.filter(
      (s) => !["review", "needs_cancellation", "active", "canceled"].includes(s.status),
    ),
  };

  const monthlyBurnCents = subs
    .filter((s) => s.status === "active" && s.cadence === "monthly")
    .reduce((sum, s) => sum + Math.abs(s.latest_amount_cents || 0), 0);
  const annualBurnCents = subs
    .filter((s) => s.status === "active" && s.cadence === "annual")
    .reduce((sum, s) => sum + Math.abs(s.latest_amount_cents || 0), 0);
  const totalAnnualizedCents = monthlyBurnCents * 12 + annualBurnCents;

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <header className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-neutral-400 text-sm mt-1">
            Pulled from SimpleFIN. Last sync:{" "}
            <span className="text-neutral-200">
              {sync ? `${fmtDate(sync.started_at)} (${sync.status})` : "never"}
            </span>
            {sync?.transactions_added != null && sync.status === "success" && (
              <span className="ml-2 text-neutral-500">
                +{sync.transactions_added} new txns
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <SeedButton />
          <SyncButton />
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Stat label="Active" value={String(grouped.active.length)} />
        <Stat
          label="Needs review"
          value={String(grouped.review.length + grouped.needs_cancellation.length)}
          accent
        />
        <Stat label="Monthly burn (active)" value={fmtCents(monthlyBurnCents)} />
        <Stat label="Annualized burn" value={fmtCents(totalAnnualizedCents)} />
      </section>

      <Filters current={sp.status} hidden={sp.hidden === "1"} />

      <Group title="Needs review" subs={grouped.review} accent="amber" />
      <Group title="Needs cancellation" subs={grouped.needs_cancellation} accent="red" />
      <Group title="Active" subs={grouped.active} />
      <Group title="Canceled" subs={grouped.canceled} muted />
      {grouped.other.length > 0 && <Group title="Other" subs={grouped.other} muted />}

      {subs.length === 0 && (
        <div className="text-neutral-400 text-center py-16 border border-dashed border-neutral-800 rounded-lg">
          No subscriptions yet. Click <span className="text-neutral-200">Sync</span> to pull
          from SimpleFIN, or <span className="text-neutral-200">Apply seed</span> to load
          Commander's known list.
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg p-4 border ${
        accent ? "border-amber-700/50 bg-amber-950/30" : "border-neutral-800 bg-neutral-900"
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function Filters({ current, hidden }: { current?: string; hidden: boolean }) {
  const items = [
    { key: undefined, label: "All" },
    { key: "active", label: "Active" },
    { key: "review", label: "Review" },
    { key: "needs_cancellation", label: "Needs cancel" },
    { key: "canceled", label: "Canceled" },
    { key: "hidden", label: "Hidden" },
  ];
  return (
    <div className="flex gap-2 flex-wrap mb-6 text-sm">
      {items.map((it) => {
        const isActive = current === it.key || (!current && !it.key && !hidden);
        const href =
          it.key === "hidden"
            ? "?status=hidden&hidden=1"
            : it.key
              ? `?status=${it.key}`
              : "?";
        return (
          <a
            key={it.label}
            href={href}
            className={`px-3 py-1 rounded border transition-colors ${
              isActive
                ? "border-neutral-200 bg-neutral-200 text-neutral-900"
                : "border-neutral-800 hover:border-neutral-600 text-neutral-300"
            }`}
          >
            {it.label}
          </a>
        );
      })}
    </div>
  );
}

function Group({
  title,
  subs,
  accent,
  muted,
}: {
  title: string;
  subs: Awaited<ReturnType<typeof listSubscriptions>>;
  accent?: "amber" | "red";
  muted?: boolean;
}) {
  if (subs.length === 0) return null;
  const accentClass =
    accent === "amber"
      ? "text-amber-400"
      : accent === "red"
        ? "text-red-400"
        : muted
          ? "text-neutral-500"
          : "text-neutral-200";
  return (
    <section className="mb-10">
      <h2 className={`text-sm uppercase tracking-wider mb-3 ${accentClass}`}>
        {title}{" "}
        <span className="text-neutral-600 normal-case tracking-normal">({subs.length})</span>
      </h2>
      <div className="border border-neutral-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Merchant</th>
              <th className="text-right px-4 py-2 font-medium">Amount</th>
              <th className="text-left px-4 py-2 font-medium">Cadence</th>
              <th className="text-left px-4 py-2 font-medium">Last</th>
              <th className="text-left px-4 py-2 font-medium">Next</th>
              <th className="text-left px-4 py-2 font-medium">Conf.</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Notes</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s) => (
              <SubscriptionRow key={s.id} sub={s} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// re-export helpers for SubscriptionRow client component
export { fmtCents, fmtDate, fmtRelative };
