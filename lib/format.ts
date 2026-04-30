export function fmtCents(cents: number | null | undefined, currency = "USD"): string {
  if (cents == null) return "—";
  const v = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2,
  }).format(v);
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toISOString().slice(0, 10);
}

export function fmtRelative(ms: number | null | undefined): string {
  if (!ms) return "—";
  const days = Math.round((ms - Date.now()) / 86_400_000);
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `${-days}d ago`;
}
