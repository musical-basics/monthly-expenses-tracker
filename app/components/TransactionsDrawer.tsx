"use client";

import { useEffect, useState } from "react";
import { getMerchantTransactionsAction } from "../actions";
import type { Subscription } from "@/lib/queries";
import { fmtCents, fmtDate } from "@/lib/format";

type Txn = {
  id: string;
  account_id: string;
  posted_at: number;
  amount_cents: number;
  description: string | null;
  payee: string | null;
  memo: string | null;
  pending: number;
};

export default function TransactionsDrawer({
  sub,
  onClose,
}: {
  sub: Subscription;
  onClose: () => void;
}) {
  const [txns, setTxns] = useState<Txn[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMerchantTransactionsAction(sub.merchant_key)
      .then((rows) => {
        if (!cancelled) setTxns(rows as Txn[]);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [sub.merchant_key]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totalCents =
    txns?.reduce((sum, t) => sum + t.amount_cents, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <button
        onClick={onClose}
        className="flex-1 bg-black/60 backdrop-blur-sm cursor-default"
        aria-label="Close drawer"
      />
      <aside className="w-full max-w-2xl bg-neutral-950 border-l border-neutral-800 overflow-y-auto shadow-2xl">
        <header className="sticky top-0 bg-neutral-950 border-b border-neutral-800 px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{sub.merchant_display}</h2>
            <p className="text-sm text-neutral-400 mt-0.5">
              {sub.cadence}
              {sub.latest_amount_cents != null && (
                <> · latest {fmtCents(Math.abs(sub.latest_amount_cents))}</>
              )}
              {" · "}
              {sub.charge_count} {sub.charge_count === 1 ? "charge" : "charges"} ({sub.confidence})
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-100 text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="p-6">
          {error && <div className="text-red-400 text-sm">{error}</div>}
          {!txns && !error && (
            <div className="text-neutral-500 text-sm">Loading…</div>
          )}
          {txns && txns.length === 0 && (
            <div className="text-neutral-500 text-sm">
              No stored transactions for this merchant. (This subscription may have been
              created from the Commander seed list before any sync.)
            </div>
          )}
          {txns && txns.length > 0 && (
            <>
              <div className="flex items-baseline justify-between mb-3 text-xs text-neutral-500">
                <span>{txns.length} transaction{txns.length === 1 ? "" : "s"}</span>
                <span>
                  Net:{" "}
                  <span
                    className={
                      totalCents < 0 ? "text-neutral-300" : "text-emerald-400"
                    }
                  >
                    {fmtCents(totalCents)}
                  </span>
                </span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-neutral-500 border-b border-neutral-800">
                  <tr>
                    <th className="text-left py-2 font-medium">Date</th>
                    <th className="text-right py-2 font-medium">Amount</th>
                    <th className="text-left py-2 font-medium pl-3">Description</th>
                    <th className="text-left py-2 font-medium pl-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t) => {
                    const isRefund = t.amount_cents > 0;
                    return (
                      <tr key={t.id} className="border-b border-neutral-900">
                        <td className="py-2 text-neutral-300 tabular-nums">
                          {fmtDate(t.posted_at)}
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${
                            isRefund ? "text-emerald-400" : "text-neutral-100"
                          }`}
                        >
                          {isRefund ? "+" : ""}
                          {fmtCents(t.amount_cents)}
                        </td>
                        <td className="py-2 pl-3 text-neutral-400 truncate max-w-[16rem]">
                          {t.payee || t.description || t.memo || "—"}
                        </td>
                        <td className="py-2 pl-3">
                          {t.pending ? (
                            <span className="text-amber-400 text-xs">pending</span>
                          ) : isRefund ? (
                            <span className="text-emerald-400 text-xs">refund</span>
                          ) : (
                            <span className="text-neutral-600 text-xs">posted</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
