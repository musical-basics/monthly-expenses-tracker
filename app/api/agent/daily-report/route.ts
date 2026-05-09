import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  getDailyReport,
  listUndeliveredReports,
  markDailyReportDelivered,
} from "@/lib/agent-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayEt() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const date = url.searchParams.get("date") || todayEt();
  const persist = url.searchParams.get("persist") !== "false";
  const report = getDailyReport(date, { persist });
  const undelivered = listUndeliveredReports();
  return NextResponse.json({ report, undelivered });
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    date?: string;
    action?: string;
    channel?: string;
    notes?: string;
  };
  const date = body.date || todayEt();
  if (body.action !== "mark_delivered") {
    return NextResponse.json({ error: "Unsupported action. Use action=mark_delivered." }, { status: 400 });
  }
  const delivery = markDailyReportDelivered(date, { channel: body.channel, notes: body.notes });
  return NextResponse.json({ ok: true, delivery });
}
