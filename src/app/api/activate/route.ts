import { NextRequest, NextResponse } from "next/server";
import { activateAccount } from "@/lib/platform-users";
import { mutationGuard } from "@/lib/auth";
import { AppError } from "@/lib/domain";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try { mutationGuard(request); return NextResponse.json(await activateAccount(await request.json()), {headers:{"Cache-Control":"no-store"}}); }
  catch(error) { return NextResponse.json({error:error instanceof AppError ? error.message : "No se pudo activar la cuenta. Revise el enlace y los datos."},{status:error instanceof AppError ? error.status : 400}); }
}
