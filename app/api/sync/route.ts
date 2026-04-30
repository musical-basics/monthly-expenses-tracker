import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runSync } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  let lookbackDays: number | undefined;
  try {
    const body = (await req.json().catch(() => null)) as { lookbackDays?: number } | null;
    if (body?.lookbackDays && Number.isFinite(body.lookbackDays)) {
      lookbackDays = Math.min(Math.max(body.lookbackDays, 1), 730);
    }
  } catch {
    // ignore
  }

  const result = await runSync({ lookbackDays });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
