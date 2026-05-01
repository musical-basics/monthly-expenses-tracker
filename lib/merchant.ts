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

  // Strip trailing reference / order numbers — NO /i flag, since reference
  // numbers are uppercase by convention and /i would let [A-Z] match lowercase
  // letters, which would eat real merchant suffixes like "Extras" or "Plus".
  s = s.replace(/\s+#?[A-Z0-9]*\d[A-Z0-9]{5,}\s*$/, ""); // require at least one digit
  s = s.replace(/\s+\d{4,}\s*$/, "");

  // Strip city / state suffixes — only match real US state abbreviations so
  // we don't eat mixed-case brand suffixes like "EXTRAS" (where "AS" isn't
  // a state) or "PLUS" (where "US" isn't a state).
  const ST = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
  // " ... CITY ST" — space-separated city + 2-letter state
  s = s.replace(new RegExp(`\\s+[A-Z]{2,}(?:\\s+[A-Z]{2,})*\\s+(?:${ST})$`), "");
  // " ...CITYST" — merged city+state (4+ letter city ending in real state code)
  s = s.replace(new RegExp(`\\s+[A-Z]{2,}(?:${ST})$`), "");

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
