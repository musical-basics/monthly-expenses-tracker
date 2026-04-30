"use client";

import { useState, useTransition } from "react";
import { seedAction } from "../actions";

export default function SeedButton() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function go() {
    setMsg(null);
    startTransition(async () => {
      const r = await seedAction();
      setMsg(`+${r.inserted} new, ${r.updated} updated`);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={go}
        disabled={pending}
        className="border border-neutral-700 px-4 py-2 rounded text-sm hover:bg-neutral-900 disabled:opacity-50"
      >
        {pending ? "Seeding…" : "Apply Commander seed"}
      </button>
      {msg && <div className="text-xs text-neutral-400">{msg}</div>}
    </div>
  );
}
