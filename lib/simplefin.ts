import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * SimpleFIN Bridge client.
 *
 * Setup token (one-time, base64-encoded URL) → POST → access URL with HTTP basic auth
 * embedded. Access URL is reusable; setup token burns on claim.
 *
 * Docs: https://www.simplefin.org/protocol.html
 */

const ACCESS_URL_CACHE = resolve(process.cwd(), "data/.access_url");

export type SimpleFinTransaction = {
  id: string;
  posted: number;
  amount: string;
  description?: string;
  payee?: string;
  memo?: string;
  pending?: boolean;
};

export type SimpleFinAccount = {
  org: { name?: string; domain?: string; "sfin-url"?: string };
  id: string;
  name: string;
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions: SimpleFinTransaction[];
};

export type SimpleFinResponse = {
  errors: string[];
  accounts: SimpleFinAccount[];
};

function redactAccessUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    if (u.username) u.username = "***";
    return u.toString();
  } catch {
    return "<unparseable>";
  }
}

async function claimSetupToken(setupToken: string): Promise<string> {
  // Setup token is base64 of the claim URL.
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(setupToken.trim(), "base64").toString("utf8").trim();
  } catch {
    throw new Error("SIMPLEFIN_SETUP_TOKEN is not valid base64");
  }
  if (!claimUrl.startsWith("http")) {
    throw new Error("Decoded setup token does not look like a URL");
  }
  const res = await fetch(claimUrl, { method: "POST" });
  if (!res.ok) {
    throw new Error(`SimpleFIN claim failed: ${res.status} ${res.statusText}`);
  }
  const accessUrl = (await res.text()).trim();
  if (!accessUrl.startsWith("http")) {
    throw new Error("SimpleFIN claim response was not a URL");
  }
  return accessUrl;
}

export async function getAccessUrl(): Promise<string> {
  const direct = process.env.SIMPLEFIN_ACCESS_URL?.trim();
  if (direct) return direct;

  if (existsSync(ACCESS_URL_CACHE)) {
    const cached = readFileSync(ACCESS_URL_CACHE, "utf8").trim();
    if (cached) return cached;
  }

  const setup = process.env.SIMPLEFIN_SETUP_TOKEN?.trim();
  if (!setup) {
    throw new Error(
      "No SimpleFIN credentials. Set SIMPLEFIN_ACCESS_URL or SIMPLEFIN_SETUP_TOKEN in .env.",
    );
  }

  const accessUrl = await claimSetupToken(setup);
  const dir = dirname(ACCESS_URL_CACHE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(ACCESS_URL_CACHE, accessUrl, { mode: 0o600 });
  return accessUrl;
}

/**
 * Scrub any access URL (with embedded creds) out of an arbitrary string.
 * Matches https://anything:anything@host... — undici's fetch error messages
 * include the raw URL, so we must filter before logging/returning.
 */
export function scrubCredsFromError(s: string): string {
  return s.replace(/https?:\/\/[^@\s/]+:[^@\s/]+@[^\s"']+/gi, "<simplefin-url-redacted>");
}

export async function fetchAccounts(opts: {
  startDate?: Date;
  endDate?: Date;
  pending?: boolean;
} = {}): Promise<SimpleFinResponse> {
  const accessUrl = await getAccessUrl();
  const u = new URL(accessUrl);

  // undici's fetch() refuses URLs with embedded credentials — pull them out
  // and send as HTTP Basic auth header instead.
  const username = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  u.username = "";
  u.password = "";

  if (!u.pathname.endsWith("/accounts")) {
    u.pathname = u.pathname.replace(/\/$/, "") + "/accounts";
  }
  if (opts.startDate) {
    u.searchParams.set("start-date", String(Math.floor(opts.startDate.getTime() / 1000)));
  }
  if (opts.endDate) {
    u.searchParams.set("end-date", String(Math.floor(opts.endDate.getTime() / 1000)));
  }
  if (opts.pending) u.searchParams.set("pending", "1");

  const headers: HeadersInit = {};
  if (username || password) {
    const basic = Buffer.from(`${username}:${password}`).toString("base64");
    headers["Authorization"] = `Basic ${basic}`;
  }

  let res: Response;
  try {
    res = await fetch(u.toString(), { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`SimpleFIN fetch failed: ${scrubCredsFromError(message)}`);
  }
  if (!res.ok) {
    // Never include URL (contains creds) in error.
    throw new Error(`SimpleFIN fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as SimpleFinResponse;
  return data;
}

export { redactAccessUrl };
