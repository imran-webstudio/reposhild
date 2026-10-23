import { resetDemoFixes } from "@/lib/demo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  resetDemoFixes();
  return Response.json({ ok: true });
}
