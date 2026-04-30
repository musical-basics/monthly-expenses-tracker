import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCS = {
  service: "Subscriptions Tracker",
  audience: "Commander / Lionel's AI agent",
  auth: {
    scheme: "Bearer",
    header: "Authorization: Bearer <AGENT_API_TOKEN>",
    note: "Required on every endpoint. Token is shared between Commander and this server via env.",
  },
  conventions: {
    timestamps: "Unix epoch milliseconds (number) for all *_at fields",
    amounts:
      "Cents (integer). Negative for debits/charges, positive for credits/refunds. Display in dollars by dividing by 100.",
    statuses: ["active", "review", "needs_cancellation", "canceled", "hidden", "unknown"],
    priorities: ["high", "normal", "low"],
    cadences: ["weekly", "monthly", "quarterly", "annual", "irregular"],
    confidences: ["high", "medium", "low"],
  },
  endpoints: [
    {
      method: "POST",
      path: "/api/sync",
      summary: "Pull latest transactions from SimpleFIN and re-run subscription detection.",
      body: { lookbackDays: "number (1-730), optional, default 180" },
      returns:
        "{ ok, transactionsAdded, accountsUpdated, subscriptionsDetected, subscriptionsUpdated, errors[], durationMs }",
    },
    {
      method: "GET",
      path: "/api/subscriptions",
      summary: "List subscriptions. Hidden ones excluded by default.",
      query: {
        status: "filter by status (optional)",
        include_hidden: "true to include hidden (optional)",
      },
      returns: "{ count, last_sync, subscriptions[] }",
    },
    {
      method: "GET",
      path: "/api/subscriptions/:id",
      summary: "Get one subscription plus its recent transactions.",
      returns: "{ subscription, transactions[] }",
    },
    {
      method: "PATCH",
      path: "/api/subscriptions/:id",
      summary:
        "Update subscription. Use this to mark as canceled, needs_cancellation, hidden, set notes, record cancellation progress, etc.",
      body: {
        status: "active | review | needs_cancellation | canceled | hidden | unknown (optional)",
        priority: "high | normal | low | null (optional)",
        owner: "personal | business | unknown | null (optional)",
        notes: "string | null (optional)",
        cancellation_progress: "string | null (optional)",
        merchant_display: "string (optional, override the auto-detected name)",
      },
      returns: "{ subscription }",
    },
    {
      method: "GET",
      path: "/api/subscriptions/upcoming",
      summary: "Subscriptions whose predicted next charge falls within window_days.",
      query: { window_days: "1-180, default 14" },
      returns: "{ window_days, count, subscriptions[] }",
    },
    {
      method: "GET",
      path: "/api/subscriptions/review",
      summary:
        "Subscriptions needing attention: status=review|needs_cancellation|unknown, or price_increase=1.",
      returns: "{ count, subscriptions[] }",
    },
    {
      method: "POST",
      path: "/api/seed",
      summary:
        "(Re-)apply the Commander-known seed list (Higgsfield, Ollama, zBackup, Teachable, BetterHelp, Verizon). Safe to call repeatedly — preserves existing user-set fields where appropriate.",
      returns: "{ inserted, updated }",
    },
    {
      method: "GET",
      path: "/api/seed",
      summary: "View the seed list without applying it.",
      returns: "{ items[] }",
    },
  ],
  workflow_for_commander: [
    "1. POST /api/sync — pull latest transactions and re-detect subscriptions.",
    "2. GET /api/subscriptions/review — find what needs attention.",
    "3. GET /api/subscriptions/upcoming?window_days=7 — surface this week's renewals.",
    "4. PATCH /api/subscriptions/:id with { status: 'canceled', cancellation_progress: 'requested 2026-04-30' } when working a cancellation.",
    "5. PATCH with { status: 'hidden' } for false positives (one-time charges that look recurring).",
  ],
  safety: [
    "Auth bearer required on every endpoint.",
    "SimpleFIN secrets live only in env / data/.access_url (chmod 600), never logged or returned.",
    "This service does NOT make financial changes — it only tracks and advises. All actual cancellations happen out-of-band.",
    "Account numbers are redacted with X's in any account_name field surfaced to the UI.",
  ],
};

export async function GET() {
  return NextResponse.json(DOCS);
}
