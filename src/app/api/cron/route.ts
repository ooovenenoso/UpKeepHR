import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try { return NextResponse.json(await tick(), {headers:{"Cache-Control":"no-store"}}); }
  catch { return NextResponse.json({error:"Revise el diagnóstico del motor."},{status:500}); }
}
