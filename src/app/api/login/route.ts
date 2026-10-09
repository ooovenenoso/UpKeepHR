import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveLogin } from "@/lib/platform-users";
import { platformAuth } from "@/lib/platform-auth";
import { mutationGuard } from "@/lib/auth";
import { appUrl } from "@/lib/config";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    mutationGuard(request);
    const data = z.object({ identifier: z.string().trim().min(1).max(200), password: z.string().min(1).max(128) }).parse(await request.json());
    const email = await resolveLogin(data.identifier);
    const account = await db.platformUser.findUnique({ where: { email }, include: { employee: true } });
    // All attempts pass through the same persistent library rate limiter.
    const result = await platformAuth.handler(new Request(new URL("/api/auth/sign-in/email",appUrl), { method: "POST", headers: request.headers, body: JSON.stringify({ email: account?.active && (!account.employeeId || account.employee?.active) ? email : "unknown@invalid.example", password: data.password }) }));
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  } catch { return NextResponse.json({error:"No se pudo iniciar sesión."},{status:400}); }
}
