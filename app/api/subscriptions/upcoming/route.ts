import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listUpcomingRenewals } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const windowDays = Math.min(
    Math.max(Number(searchParams.get("window_days") || 14), 1),
    180,
  );
  const subs = listUpcomingRenewals(windowDays);
  return NextResponse.json({ window_days: windowDays, count: subs.length, subscriptions: subs });
}
