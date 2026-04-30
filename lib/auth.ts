import { NextRequest, NextResponse } from "next/server";

/**
 * Bearer token gate for /api/* routes.
 *
 * Always required. Token comes from AGENT_API_TOKEN env. Compares with
 * constant-time-ish equality. Skipping auth is not allowed (no debug mode).
 */
export function requireAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.AGENT_API_TOKEN;
  if (!expected || expected === "replace-me-with-a-long-random-string" || expected.length < 16) {
    return NextResponse.json(
      { error: "Server misconfigured: AGENT_API_TOKEN not set or too short (min 16 chars)" },
      { status: 500 },
    );
  }
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const provided = match?.[1]?.trim();
  if (!provided || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Redact account numbers from any string. SimpleFIN account names sometimes
 * include the last 4 digits — replace any 4+ digit run with X's.
 */
export function redactAccount(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\b\d{4,}\b/g, (m) => "X".repeat(m.length));
}
