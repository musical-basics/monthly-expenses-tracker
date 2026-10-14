"use client";

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { updateSubscriptionAction } from "../actions";
import type {
  SubscriptionAccount,
  SubscriptionUpdate,
  SubscriptionWithAccounts,
} from "@/lib/queries";
import { fmtCents, fmtDate, fmtRelative } from "@/lib/format";
import TransactionsDrawer from "./TransactionsDrawer";

type Sub = SubscriptionWithAccounts;
type Bucket = "check_up" | "active" | "canceled";
type View = "all" | Bucket;
type SortKey = "name" | "cost" | "last" | "next";

const DAY_MS = 86_400_000;
// How long past the expected renewal date before "no charge yet" counts as evidence.
const GRACE_DAYS = 7;
const NO_ACCOUNT = "__none__";

const ACCOUNT_DOTS = [
  "bg-sky-400",
  "bg-violet-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-cyan-400",
  "bg-lime-400",
  "bg-fuchsia-400",
  "bg-orange-400",
  "bg-teal-400",
];

const PER_MONTH: Record<string, number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
};

const SECTIONS: { key: Bucket; title: string; blurb: string; accent: string }[] = [
  {
    key: "check_up",
    title: "Check up on",
    blurb: "Flagged to double-check — e.g. confirm a cancellation actually went through.",
    accent: "text-amber-400",
  },
  {
    key: "active",
    title: "Still active",
    blurb: "Not marked canceled yet.",
    accent: "text-neutral-200",
  },
  {
    key: "canceled",
    title: "Canceled",
    blurb: "You've canceled these.",
    accent: "text-neutral-500",
  },
];

const SORTERS: Record<SortKey, (a: Sub, b: Sub) => number> = {
  name: (a, b) =>
    a.merchant_display.localeCompare(b.merchant_display, "en", { sensitivity: "base" }),
  cost: (a, b) => monthlyCents(b) - monthlyCents(a),
  last: (a, b) => (b.last_charged_at ?? 0) - (a.last_charged_at ?? 0),
  next: (a, b) =>
    (a.predicted_next_at ?? Number.MAX_SAFE_INTEGER) -
    (b.predicted_next_at ?? Number.MAX_SAFE_INTEGER),
};

function bucketOf(s: Sub): Bucket {
  if (s.check_up === 1) return "check_up";
  return s.status === "canceled" ? "canceled" : "active";
}

function monthlyCents(s: Sub): number {
  const per = PER_MONTH[s.cadence];
  if (!per || s.latest_amount_cents == null) return 0;
  return Math.abs(s.latest_amount_cents) * per;
}

type Hint = { tone: "bad" | "good" | "wait" | "stale" | "muted"; text: string };

const HINT_STYLES: Record<Hint["tone"], string> = {
  bad: "text-red-400",
  good: "text-emerald-400",
  wait: "text-amber-300",
  stale: "text-sky-300",
  muted: "text-neutral-400",
};

/** What the charge history says, judged against data as of the last successful sync. */
function chargeHint(s: Sub, asOf: number | null): Hint | null {
  if (!s.last_charged_at) return null;
  const overdue =
    s.predicted_next_at != null &&
    asOf != null &&
    asOf > s.predicted_next_at + GRACE_DAYS * DAY_MS;

  if (s.status === "canceled" || s.check_up === 1) {
    if (s.canceled_at && s.last_charged_at > s.canceled_at) {
      return {
        tone: "bad",
        text: `Charged ${fmtDate(s.last_charged_at)} — after you marked it canceled`,
      };
    }
    if (overdue) {
      return { tone: "good", text: `No charge since expected ${fmtDate(s.predicted_next_at)}` };
    }
    if (s.predicted_next_at) {
      return {
        tone: "wait",
        text: `Watch for a charge ~${fmtDate(s.predicted_next_at)} (${fmtRelative(s.predicted_next_at)})`,
      };
    }
    return { tone: "muted", text: `Last charged ${fmtDate(s.last_charged_at)}` };
  }

  if (overdue) {
    return {
      tone: "stale",
      text: `No charge since expected ${fmtDate(s.predicted_next_at)} — already canceled?`,
    };
  }
  if (s.predicted_next_at) {
    return {
      tone: "muted",
      text: `Next ~${fmtDate(s.predicted_next_at)} (${fmtRelative(s.predicted_next_at)})`,
    };
  }
  return { tone: "muted", text: `Last charged ${fmtDate(s.last_charged_at)}` };
}

/** Mirror of updateSubscription() so the UI reflects a click before the server answers. */
function applyPatch(s: Sub, patch: SubscriptionUpdate): Sub {
  const next = { ...s };
  if (patch.status !== undefined) {
    next.status = patch.status;
    next.canceled_at =
      patch.status === "canceled" ? (s.status === "canceled" ? s.canceled_at : Date.now()) : null;
  }
  if (patch.check_up !== undefined) next.check_up = patch.check_up ? 1 : 0;
  if (patch.notes !== undefined) next.notes = patch.notes;
  return next;
}

export default function ReviewDashboard({
  subs,
  syncedAt,
}: {
  subs: Sub[];
  syncedAt: number | null;
}) {
  const [optimisticSubs, addPatch] = useOptimistic(
    subs,
    (state, { id, patch }: { id: number; patch: SubscriptionUpdate }) =>
      state.map((s) => (s.id === id ? applyPatch(s, patch) : s)),
  );
  const [, startTransition] = useTransition();
  const [view, setView] = useState<View>("all");
  const [accountId, setAccountId] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [query, setQuery] = useState("");
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(id: number, patch: SubscriptionUpdate) {
    setError(null);
    startTransition(async () => {
      addPatch({ id, patch });
      try {
        await updateSubscriptionAction(id, patch);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save that change");
      }
    });
  }

  const accounts = useMemo(() => {
    const byId = new Map<string, SubscriptionAccount>();
    for (const s of subs) for (const a of s.accounts) if (!byId.has(a.account_id)) byId.set(a.account_id, a);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [subs]);
  const dotFor = useMemo(
    () => new Map(accounts.map((a, i) => [a.account_id, ACCOUNT_DOTS[i % ACCOUNT_DOTS.length]])),
    [accounts],
  );
  const hasUnlinked = subs.some((s) => s.accounts.length === 0);

  const q = query.trim().toLowerCase();
  const visible = optimisticSubs
    .filter((s) => {
      if (accountId === NO_ACCOUNT && s.accounts.length > 0) return false;
      if (accountId && accountId !== NO_ACCOUNT && !s.accounts.some((a) => a.account_id === accountId)) {
        return false;
      }
      if (!q) return true;
      return [s.merchant_display, s.notes ?? "", ...s.accounts.map((a) => a.name)].some((t) =>
        t.toLowerCase().includes(q),
      );
    })
    .sort(SORTERS[sort]);

  const byBucket: Record<Bucket, Sub[]> = { check_up: [], active: [], canceled: [] };
  for (const s of visible) byBucket[bucketOf(s)].push(s);

  const chargedAfterCancel = visible.filter((s) => chargeHint(s, syncedAt)?.tone === "bad");
  const activeMonthly = visible
    .filter((s) => s.status !== "canceled")
    .reduce((sum, s) => sum + monthlyCents(s), 0);
  const savedMonthly = visible
    .filter((s) => s.status === "canceled")
    .reduce((sum, s) => sum + monthlyCents(s), 0);

  const drawerSub = drawerId != null ? optimisticSubs.find((s) => s.id === drawerId) : null;
  const shownSections = SECTIONS.filter(
    (sec) => (view === "all" ? byBucket[sec.key].length > 0 : view === sec.key),
  );

  return (
    <>
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Tile
          label="Still active"
          value={String(byBucket.active.length)}
          sub={`≈ ${fmtCents(Math.round(activeMonthly))}/mo still being paid`}
          selected={view === "active"}
          onClick={() => setView(view === "active" ? "all" : "active")}
        />
        <Tile
          label="Check up on"
          value={String(byBucket.check_up.length)}
          sub="flagged to double-check"
          tone="amber"
          selected={view === "check_up"}
          onClick={() => setView(view === "check_up" ? "all" : "check_up")}
        />
        <Tile
          label="Canceled"
          value={String(byBucket.canceled.length)}
          sub={`≈ ${fmtCents(Math.round(savedMonthly))}/mo saved`}
          selected={view === "canceled"}
          onClick={() => setView(view === "canceled" ? "all" : "canceled")}
        />
      </section>

      {chargedAfterCancel.length > 0 && (
        <div className="mb-6 rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          <span className="font-medium">Charged after you marked them canceled:</span>{" "}
          {chargedAfterCancel.map((s) => s.merchant_display).join(", ")}. Worth a look — the
          cancellation may not have gone through.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-6 text-sm">
        <div className="flex rounded border border-neutral-800 overflow-hidden" role="group">
          {(["all", "active", "check_up", "canceled"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`px-3 py-1.5 border-l border-neutral-800 first:border-l-0 transition-colors ${
                view === v
                  ? "bg-neutral-200 text-neutral-900"
                  : "text-neutral-300 hover:bg-neutral-900"
              }`}
            >
              {v === "all" ? "All" : SECTIONS.find((s) => s.key === v)!.title}
              <span className={`ml-1.5 tabular-nums ${view === v ? "text-neutral-600" : "text-neutral-500"}`}>
                {v === "all" ? visible.length : byBucket[v].length}
              </span>
            </button>
          ))}
        </div>

        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          aria-label="Filter by account"
          className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 max-w-[16rem]"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.account_id} value={a.account_id}>
              {a.name}
            </option>
          ))}
          {hasUnlinked && <option value={NO_ACCOUNT}>No charges on file</option>}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort"
          className="bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5"
        >
          <option value="name">Sort: Name</option>
          <option value="cost">Sort: Cost / month</option>
          <option value="last">Sort: Last charged</option>
          <option value="next">Sort: Next charge</option>
        </select>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search merchant, note, account…"
          className="bg-neutral-950 border border-neutral-800 rounded px-3 py-1.5 flex-1 min-w-[12rem] placeholder:text-neutral-600"
        />
      </div>

      {error && <div className="mb-4 text-sm text-red-400">{error}</div>}

      {shownSections.map((sec) => (
        <section key={sec.key} className="mb-10">
          <div className="flex items-baseline gap-3 mb-3">
            <h2 className={`text-sm uppercase tracking-wider ${sec.accent}`}>
              {sec.title}{" "}
              <span className="text-neutral-600 normal-case tracking-normal">
                ({byBucket[sec.key].length})
              </span>
            </h2>
            <p className="text-xs text-neutral-600 hidden sm:block">{sec.blurb}</p>
          </div>
          {byBucket[sec.key].length === 0 ? (
            <div className="text-neutral-500 text-sm text-center py-10 border border-dashed border-neutral-800 rounded-lg">
              Nothing here{q || accountId ? " for this filter" : ""}.
            </div>
          ) : (
            <div className="border border-neutral-800 rounded-lg overflow-hidden">
              <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_13rem] gap-x-4 px-4 py-2 bg-neutral-900 text-neutral-400 text-xs uppercase tracking-wider">
                <div>Subscription</div>
                <div>Account</div>
                <div>Charges</div>
                <div className="text-right">Mark</div>
              </div>
              <ul>
                {byBucket[sec.key].map((s) => (
                  <Row
                    key={s.id}
                    sub={s}
                    hint={chargeHint(s, syncedAt)}
                    dotFor={dotFor}
                    onUpdate={(patch) => update(s.id, patch)}
                    onOpenCharges={() => setDrawerId(s.id)}
                  />
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}

      {view === "all" && shownSections.length === 0 && (
        <div className="text-neutral-400 text-center py-16 border border-dashed border-neutral-800 rounded-lg">
          {subs.length === 0 ? "No subscriptions yet — sync from SimpleFIN first." : "No matches."}
        </div>
      )}

      {drawerSub && <TransactionsDrawer sub={drawerSub} onClose={() => setDrawerId(null)} />}
    </>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
  selected,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "amber";
  selected: boolean;
  onClick: () => void;
}) {
  const base =
    tone === "amber" ? "border-amber-700/50 bg-amber-950/30" : "border-neutral-800 bg-neutral-900";
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`text-left rounded-lg p-4 border transition-colors ${base} ${
        selected ? "ring-2 ring-neutral-300" : "hover:border-neutral-600"
      }`}
    >
      <div
        className={`text-xs uppercase tracking-wider ${tone === "amber" ? "text-amber-400" : "text-neutral-400"}`}
      >
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      <div className="text-xs text-neutral-500 mt-1">{sub}</div>
    </button>
  );
}

function Row({
  sub,
  hint,
  dotFor,
  onUpdate,
  onOpenCharges,
}: {
  sub: Sub;
  hint: Hint | null;
  dotFor: Map<string, string>;
  onUpdate: (patch: SubscriptionUpdate) => void;
  onOpenCharges: () => void;
}) {
  const canceled = sub.status === "canceled";
  const checkUp = sub.check_up === 1;
  const [primary, ...others] = sub.accounts;

  return (
    <li className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_13rem] gap-x-4 gap-y-2 px-4 py-3 border-t border-neutral-800 first:border-t-0 hover:bg-neutral-900/40">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-medium ${canceled ? "text-neutral-400" : ""}`}>
            {sub.merchant_display}
          </span>
          {(sub.status === "review" || sub.status === "needs_cancellation" || sub.status === "unknown") && (
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded border ${
                sub.status === "needs_cancellation"
                  ? "bg-red-900/40 text-red-300 border-red-800"
                  : "bg-neutral-800 text-neutral-300 border-neutral-700"
              }`}
            >
              {sub.status === "needs_cancellation" ? "needs cancel" : sub.status}
            </span>
          )}
          {sub.price_increase === 1 && sub.prior_amount_cents != null && (
            <span className="text-[11px] text-amber-400">
              ↑ from {fmtCents(Math.abs(sub.prior_amount_cents))}
            </span>
          )}
        </div>
        <div className="text-xs text-neutral-500 mt-0.5 tabular-nums">
          {sub.latest_amount_cents != null ? fmtCents(Math.abs(sub.latest_amount_cents)) : "—"}
          {" · "}
          {sub.cadence}
          {sub.charge_count > 0 && (
            <>
              {" · "}
              <button
                onClick={onOpenCharges}
                className="hover:text-neutral-200 underline decoration-dotted underline-offset-2"
              >
                {sub.charge_count} {sub.charge_count === 1 ? "charge" : "charges"}
              </button>
            </>
          )}
        </div>
        <NoteEditor value={sub.notes} onSave={(notes) => onUpdate({ notes })} />
      </div>

      <div className="min-w-0 text-sm">
        {primary ? (
          <>
            <AccountLabel acct={primary} dot={dotFor.get(primary.account_id)} />
            {others.map((a) => (
              <div
                key={a.account_id}
                className="flex items-center gap-1.5 text-xs text-neutral-500 mt-1 min-w-0"
                title={`${a.org_name ?? ""} ${a.name} — ${a.charge_count} charges, last ${fmtDate(a.last_charged_at)}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 opacity-60 ${dotFor.get(a.account_id) ?? "bg-neutral-500"}`} />
                <span className="truncate">
                  also {a.name} · last {fmtDate(a.last_charged_at)}
                </span>
              </div>
            ))}
          </>
        ) : (
          <span className="text-xs text-neutral-600">No charges on file</span>
        )}
      </div>

      <div className={`text-xs leading-relaxed ${hint ? HINT_STYLES[hint.tone] : "text-neutral-600"}`}>
        {hint?.text ?? "—"}
        {canceled && sub.canceled_at && (
          <div className="text-neutral-600 mt-0.5">Marked canceled {fmtDate(sub.canceled_at)}</div>
        )}
      </div>

      <div className="flex md:justify-end items-start gap-2">
        <button
          onClick={() => onUpdate({ status: canceled ? "active" : "canceled" })}
          aria-pressed={canceled}
          title={canceled ? "Undo — move back to active" : "I've canceled this"}
          className={`w-[6.5rem] px-2 py-1.5 rounded border text-xs font-medium transition-colors ${
            canceled
              ? "bg-neutral-200 text-neutral-900 border-neutral-200 hover:bg-white"
              : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
          }`}
        >
          {canceled ? "✓ Canceled" : "Canceled"}
        </button>
        <button
          onClick={() => onUpdate({ check_up: !checkUp })}
          aria-pressed={checkUp}
          title={checkUp ? "Done checking — clear the flag" : "Flag to double-check later"}
          className={`w-[6.5rem] px-2 py-1.5 rounded border text-xs font-medium transition-colors ${
            checkUp
              ? "bg-amber-400 text-neutral-950 border-amber-400 hover:bg-amber-300"
              : "border-neutral-700 text-neutral-300 hover:border-amber-700 hover:text-amber-300"
          }`}
        >
          {checkUp ? "⚑ Check up" : "Check up"}
        </button>
      </div>
    </li>
  );
}

function AccountLabel({ acct, dot }: { acct: SubscriptionAccount; dot?: string }) {
  return (
    <div
      className="flex items-center gap-2 min-w-0"
      title={`${acct.org_name ?? ""} ${acct.name} — ${acct.charge_count} charges, last ${fmtDate(acct.last_charged_at)}`}
    >
      <span className={`h-2 w-2 rounded-full shrink-0 ${dot ?? "bg-neutral-500"}`} />
      <span className="truncate text-neutral-200">{acct.name}</span>
    </div>
  );
}

function NoteEditor({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const discard = useRef(false);

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(value ?? "");
          setEditing(true);
        }}
        className={`block text-left text-xs mt-1 max-w-full truncate ${
          value ? "text-neutral-400 hover:text-neutral-200" : "text-neutral-600 hover:text-neutral-300"
        }`}
        title={value ?? "Add a note"}
      >
        {value || "+ note"}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          discard.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const next = draft.trim() || null;
        if (!discard.current && next !== (value || null)) onSave(next);
        discard.current = false;
        setEditing(false);
      }}
      placeholder="e.g. canceled via website 10/12, confirmation email saved"
      className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-xs"
    />
  );
}
