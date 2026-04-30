"use client";

import { useState, useTransition } from "react";
import { syncAction } from "../actions";

export default function SyncButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function go() {
    setMsg(null);
    startTransition(async () => {
      try {
        const r = await syncAction();
        if (r.ok) {
          setMsg(
            `+${r.transactionsAdded} txns, ${r.subscriptionsDetected} new subs, ${r.subscriptionsUpdated} updated`,
          );
        } else {
          setMsg(`Error: ${r.errors.join("; ")}`);
        }
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Sync failed");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={go}
        disabled={pending}
        className="bg-neutral-100 text-neutral-900 px-4 py-2 rounded font-medium text-sm hover:bg-white disabled:opacity-50"
      >
        {pending ? "Syncing…" : "Sync from SimpleFIN"}
      </button>
      {msg && <div className="text-xs text-neutral-400 max-w-xs text-right">{msg}</div>}
    </div>
  );
}
