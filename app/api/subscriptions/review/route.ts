import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { listNeedingReview, withAccounts } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const subs = withAccounts(listNeedingReview());
  return NextResponse.json({ count: subs.length, subscriptions: subs });
}
