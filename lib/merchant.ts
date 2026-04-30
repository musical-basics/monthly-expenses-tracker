/**
 * Normalize a payee/description string into a stable merchant key for grouping
 * recurring charges. Strips card processor prefixes, trailing reference numbers,
 * city/state, and lowercases.
 */
export function normalizeMerchant(raw: string): { key: string; display: string } {
  if (!raw) return { key: "unknown", display: "Unknown" };
  let s = raw.trim();

  // Strip common processor prefixes
  s = s.replace(/^(SQ \*|SP \*|TST\* ?|PAYPAL \*|PP\*|GOOGLE \*|GOOGLE\*|APPLE\.COM\/BILL|AMZN MKTP US\*?|AMZN MKTP\*?)/i, "");
  s = s.replace(/^(POS DEBIT|DEBIT CARD PURCHASE|CHECKCARD|CHECK CARD|RECURRING|AUTOPAY)\s*[-#:]?\s*/i, "");

  // Strip trailing reference / order numbers
  s = s.replace(/\s+#?[A-Z0-9]{6,}\s*$/i, "");
  s = s.replace(/\s+\d{4,}\s*$/i, "");

  // Strip city / state suffixes like "  SAN FRANCISCOCA" or "  SAN FRANCISCO CA"
  s = s.replace(/\s+[A-Z][A-Z\s]+\s?[A-Z]{2}\s*$/i, "");

  // Collapse whitespace, trim punctuation
  s = s.replace(/[*]+/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/[.,:;\-]+$/g, "").trim();

  if (!s) return { key: "unknown", display: raw };

  const display = s
    .split(" ")
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");

  return { key: s.toLowerCase(), display };
}

export function parseAmountToCents(amount: string): number {
  // SimpleFIN amounts are decimal strings, negative for debits
  const f = parseFloat(amount);
  if (Number.isNaN(f)) return 0;
  return Math.round(f * 100);
}
