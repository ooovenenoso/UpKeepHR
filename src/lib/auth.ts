import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
import { authSecret, localMode } from "./config";
import { assert, normalize, normalizeCpid } from "./domain";
import { queueMessage, deliverMessage } from "./mail";
import { z } from "zod";
import { platformAuth } from "./platform-auth";
export type Actor = Awaited<ReturnType<typeof currentUser>>;
export const tokenHash = (value: string) =>
  createHmac("sha256", authSecret).update(value).digest("hex");
export function localhostOnly(request: NextRequest) {
  const host = request.nextUrl.hostname;
  assert(
    localMode && ["localhost", "127.0.0.1", "[::1]"].includes(host),
    "La bandeja de pruebas solo está disponible en localhost.",
    404,
  );
}
export function mutationGuard(request: NextRequest) {
  assert(
    request.headers.get("x-rh-request") === "1",
    "Solicitud inválida.",
    403,
  );
  const origin = request.headers.get("origin");
  if (origin)
    assert(
      new URL(origin).host === request.headers.get("host"),
      "Origen inválido.",
      403,
    );
}
export async function currentUser(request: NextRequest) {
  const auth = await platformAuth.api.getSession({ headers: request.headers });
  if (auth) {
    const account = await db.platformUser.findUnique({ where: { id: auth.user.id }, include: { employee: true } });
    assert(account?.active && (!account.employeeId || account.employee?.active), "La sesión expiró.", 401);
    assert(!["SUPERADMIN", "RH"].includes(account.role) || account.twoFactorEnabled, "Configure la autenticadora para acceder a RH.", 403);
    return {
      ...(account.employee ?? { id: account.id, cpid: "", lastNames: "", site: "Administración", position: "Administración", hireDate: "", source: "MANUAL", legacyData: null, supervisorId: null, createdAt: account.createdAt }),
      name: account.name, email: account.email, role: account.role, active: account.active, accountId: account.id,
    };
  }
  assert(process.env.ALLOW_LEGACY_TEST_SESSION === "true" && process.env.DATABASE_SCHEMA === "hhrr_test", "Inicie sesión.", 401);
  const token = request.cookies.get("rh-session")?.value;
  assert(token, "Inicie sesión.", 401);
  const session = await db.session.findUnique({
    where: { id: tokenHash(token) },
    include: { employee: true },
  });
  assert(
    session && session.expiresAt > new Date() && session.employee.active,
    "La sesión expiró.",
    401,
  );
  return { ...session.employee, accountId: session.employee.id };
}
export async function requestCode(request: NextRequest, input: unknown) {
  const { cpid, lastNames } = z
    .object({
      cpid: z.string().min(1).max(64),
      lastNames: z.string().min(2).max(100),
    })
    .parse(input);
  const identifier = normalizeCpid(cpid),
    ipKey = tokenHash(
      localMode
        ? "localhost"
        : (request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown"),
    );
  const since = new Date(Date.now() - 3600000);
  const count = await db.challenge.count({
    where: { createdAt: { gt: since }, OR: [{ identifier }, { ipKey }] },
  });
  assert(count < 20, "Demasiados intentos. Intente de nuevo en una hora.", 429);
  const personal = await db.challenge.count({
    where: { identifier, createdAt: { gt: since } },
  });
  assert(personal < 5, "Solicite un código nuevo más tarde.", 429);
  const recent = await db.challenge.findFirst({
    where: { identifier },
    orderBy: { createdAt: "desc" },
  });
  assert(
    !recent || Date.now() - recent.createdAt.getTime() >= 60000,
    "Espere un minuto antes de solicitar otro código.",
    429,
  );
  const employee = await db.employee.findUnique({
    where: { cpid: identifier },
  });
  const match =
    employee?.active && normalize(employee.lastNames) === normalize(lastNames);
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const challenge = await db.challenge.create({
    data: {
      employeeId: match ? employee.id : null,
      identifier,
      ipKey,
      codeHash: tokenHash(code),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  if (match) {
    const message = await queueMessage(
      `auth:${challenge.id}`,
      "AUTH",
      [employee.email],
      "Código de acceso a RH",
      [`Su código de acceso es ${code}. Válido durante diez minutos.`],
      employee.id,
    );
    await deliverMessage(message.id);
  }
  return {
    challengeId: challenge.id,
    message:
      "Si los datos corresponden a un empleado activo, recibirá un código en su correo registrado.",
  };
}
export async function verifyCode(input: unknown, secure = false) {
  const { challengeId, code } = z
    .object({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) })
    .parse(input);
  const token = randomBytes(32).toString("hex");
  const employee = await db.$transaction(async (tx) => {
    const c = await tx.challenge.findUnique({ where: { id: challengeId } });
    assert(
      c && !c.consumed && c.attempts < 5 && c.expiresAt > new Date(),
      "Código inválido o vencido.",
      401,
    );
    await tx.challenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });
    const valid = timingSafeEqual(
      Buffer.from(c.codeHash),
      Buffer.from(tokenHash(code)),
    );
    if (!valid || !c.employeeId) return null;
    const user = await tx.employee.findUnique({ where: { id: c.employeeId } });
    if (!user?.active) return null;
    await tx.challenge.update({
      where: { id: challengeId },
      data: { consumed: true },
    });
    await tx.session.create({
      data: {
        id: tokenHash(token),
        employeeId: user.id,
        expiresAt: new Date(Date.now() + 8 * 3600000),
      },
    });
    return user;
  });
  assert(employee, "Código inválido o vencido.", 401);
  const response = NextResponse.json({
    employee: { id: employee.id, name: employee.name, role: employee.role },
  });
  response.cookies.set("rh-session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: 8 * 3600,
  });
  return response;
}
