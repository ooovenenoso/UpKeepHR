import { NextRequest, NextResponse } from "next/server";
import { platformAuth } from "@/lib/platform-auth";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: NextRequest) {
  const route = request.nextUrl.pathname.replace("/api/auth", "");
  const allowed = ["/sign-in/email", "/sign-out", "/get-session", "/change-password"];
  if (!allowed.includes(route) && !route.startsWith("/two-factor/")) return NextResponse.json({ error: "Ruta no habilitada." }, { status: 404 });
  if (route === "/sign-in/email") {
    const body = await request.clone().json().catch(()=>({}));
    const account = typeof body.email === "string" ? await db.platformUser.findUnique({ where: { email: body.email.toLowerCase() }, include: { employee: true } }) : null;
    if (!account?.active || (account.employeeId && !account.employee?.active)) return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
  }
  const result = await platformAuth.handler(request);
  result.headers.set("Cache-Control", "private, no-store");
  return result;
}
export const GET = handler;
export const POST = handler;
