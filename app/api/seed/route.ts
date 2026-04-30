import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { applySeed, COMMANDER_SEED } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  return NextResponse.json({ items: COMMANDER_SEED });
}

export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const result = applySeed();
  return NextResponse.json(result);
}
