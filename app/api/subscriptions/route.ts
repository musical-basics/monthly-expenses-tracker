import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listSubscriptions, lastSync } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const includeHidden = searchParams.get("include_hidden") === "true";

  const subscriptions = listSubscriptions({ status, includeHidden });
  return NextResponse.json({
    count: subscriptions.length,
    last_sync: lastSync(),
    subscriptions,
  });
}
