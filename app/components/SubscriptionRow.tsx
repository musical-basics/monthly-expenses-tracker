"use client";

import { useState, useTransition } from "react";
import { updateSubscriptionAction } from "../actions";
import type { Subscription } from "@/lib/queries";
import { fmtCents, fmtDate, fmtRelative } from "@/lib/format";
import TransactionsDrawer from "./TransactionsDrawer";

const STATUS_OPTIONS = [
  "active",
  "review",
  "needs_cancellation",
  "canceled",
  "hidden",
  "unknown",
] as const;

const PRIORITY_OPTIONS = ["", "high", "normal", "low"] as const;

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-900/40 text-emerald-300 border-emerald-800",
  review: "bg-amber-900/40 text-amber-300 border-amber-800",
  needs_cancellation: "bg-red-900/40 text-red-300 border-red-800",
  canceled: "bg-neutral-800 text-neutral-400 border-neutral-700",
  hidden: "bg-neutral-900 text-neutral-500 border-neutral-800",
  unknown: "bg-neutral-800 text-neutral-300 border-neutral-700",
};

const CONF_STYLES: Record<string, string> = {
  high: "text-emerald-400",
  medium: "text-amber-400",
  low: "text-neutral-500",
};

export default function SubscriptionRow({ sub }: { sub: Subscription }) {
  const [open, setOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [status, setStatus] = useState(sub.status);
  const [notes, setNotes] = useState(sub.notes || "");
  const [priority, setPriority] = useState(sub.priority || "");
  const [cancellationProgress, setCancellationProgress] = useState(
    sub.cancellation_progress || "",
  );
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      await updateSubscriptionAction(sub.id, {
        status,
        notes: notes || null,
        priority: (priority || null) as Subscription["priority"],
        cancellation_progress: cancellationProgress || null,
      });
      setOpen(false);
    });
  }

  function quickSetStatus(newStatus: Subscription["status"]) {
    setStatus(newStatus);
    startTransition(async () => {
      await updateSubscriptionAction(sub.id, { status: newStatus });
    });
  }

  return (
    <>
      <tr className="border-t border-neutral-800 hover:bg-neutral-900/50">
        <td className="px-4 py-3">
          <div className="font-medium">{sub.merchant_display}</div>
          {sub.price_increase === 1 && sub.prior_amount_cents != null && (
            <div className="text-xs text-amber-400 mt-0.5">
              ↑ price up from {fmtCents(Math.abs(sub.prior_amount_cents))}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          {sub.latest_amount_cents != null
            ? fmtCents(Math.abs(sub.latest_amount_cents))
            : "—"}
        </td>
        <td className="px-4 py-3 text-neutral-400">{sub.cadence}</td>
        <td className="px-4 py-3 text-neutral-400">{fmtDate(sub.last_charged_at)}</td>
        <td className="px-4 py-3 text-neutral-400">
          {sub.predicted_next_at ? (
            <>
              {fmtDate(sub.predicted_next_at)}
              <span className="text-neutral-600 text-xs ml-1">
                ({fmtRelative(sub.predicted_next_at)})
              </span>
            </>
          ) : (
            "—"
          )}
        </td>
        <td className={`px-4 py-3 ${CONF_STYLES[sub.confidence] || ""}`}>{sub.confidence}</td>
        <td className="px-4 py-3">
          <span
            className={`text-xs px-2 py-0.5 rounded border ${STATUS_STYLES[sub.status] || ""}`}
          >
            {sub.status}
          </span>
        </td>
        <td className="px-4 py-3 text-neutral-400 max-w-xs">
          <div className="truncate" title={sub.notes || ""}>
            {sub.notes || (
              <button
                onClick={() => setDrawerOpen(true)}
                className="text-neutral-400 hover:text-neutral-100 underline decoration-dotted underline-offset-2"
              >
                {sub.charge_count
                  ? `${sub.charge_count} ${sub.charge_count === 1 ? "charge" : "charges"}`
                  : "—"}
              </button>
            )}
          </div>
          {sub.notes && sub.charge_count > 0 && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="text-xs text-neutral-600 hover:text-neutral-300 underline decoration-dotted underline-offset-2 mt-0.5"
            >
              {sub.charge_count} {sub.charge_count === 1 ? "charge" : "charges"}
            </button>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            onClick={() => setOpen(!open)}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            {open ? "close" : "edit"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-neutral-800 bg-neutral-900/30">
          <td colSpan={9} className="px-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <label className="md:col-span-3 text-xs">
                <div className="text-neutral-500 mb-1">Status</div>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Subscription["status"])}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-sm"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="md:col-span-2 text-xs">
                <div className="text-neutral-500 mb-1">Priority</div>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-sm"
                >
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o || "—"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="md:col-span-7 text-xs">
                <div className="text-neutral-500 mb-1">Notes</div>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-sm"
                  placeholder="why this is flagged, what to do, etc."
                />
              </label>
              <label className="md:col-span-12 text-xs">
                <div className="text-neutral-500 mb-1">Cancellation progress</div>
                <input
                  value={cancellationProgress}
                  onChange={(e) => setCancellationProgress(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1.5 text-sm"
                  placeholder="e.g. emailed support 2026-04-29, awaiting confirmation"
                />
              </label>
              <div className="md:col-span-12 flex gap-2 mt-1">
                <button
                  onClick={save}
                  disabled={pending}
                  className="bg-neutral-100 text-neutral-900 px-3 py-1.5 rounded text-sm font-medium hover:bg-white disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => quickSetStatus("canceled")}
                  className="border border-neutral-700 px-3 py-1.5 rounded text-sm hover:bg-neutral-800"
                >
                  Mark canceled
                </button>
                <button
                  onClick={() => quickSetStatus("needs_cancellation")}
                  className="border border-red-900 text-red-300 px-3 py-1.5 rounded text-sm hover:bg-red-950/50"
                >
                  Needs cancellation
                </button>
                <button
                  onClick={() => quickSetStatus("hidden")}
                  className="border border-neutral-800 text-neutral-500 px-3 py-1.5 rounded text-sm hover:bg-neutral-900"
                >
                  Hide (false positive)
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
      {drawerOpen && (
        <TransactionsDrawer sub={sub} onClose={() => setDrawerOpen(false)} />
      )}
    </>
  );
}
