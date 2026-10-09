import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { db } from "./db";
import { assert, normalizeCpid } from "./domain";
import { appUrl } from "./config";
import { audit, isRh } from "./compliance";
import type { Employee } from "../generated/prisma/client";
export const activationHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createActivation(userId: string | null, purpose = "ACTIVATE") {
  const token = randomBytes(32).toString("hex");
  await db.activation.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  await db.activation.create({ data: { userId, purpose, tokenHash: activationHash(token), expiresAt: new Date(Date.now() + 24 * 3600000) } });
  return `${appUrl}/activar#${token}`;
}
export async function activateAccount(input: unknown) {
  const data = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().trim().min(3).max(160).optional(), email: z.email().optional(), password: z.string().min(12).max(128) }).parse(input);
  const password = await hashPassword(data.password);
  return db.$transaction(async tx => {
    const activation = await tx.activation.findUnique({ where: { tokenHash: activationHash(data.token) } });
    assert(activation && !activation.consumedAt && activation.expiresAt > new Date(), "Enlace vencido o utilizado.", 400);
    const consumed = await tx.activation.updateMany({ where: { id: activation.id, consumedAt: null }, data: { consumedAt: new Date() } });
    assert(consumed.count === 1, "Enlace utilizado.", 409);
    let userId = activation.userId;
    if (activation.purpose === "BOOTSTRAP") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7364031)`;
      assert(!(await tx.platformUser.count({ where: { role: "SUPERADMIN" } })), "La plataforma ya tiene superadmin.", 409);
      assert(data.name && data.email, "Indique nombre y correo.");
      userId = randomUUID();
      await tx.platformUser.create({ data: { id: userId, name: data.name, email: data.email.toLowerCase(), emailVerified: true, role: "SUPERADMIN" } });
    }
    assert(userId, "Cuenta inválida.");
    const user = await tx.platformUser.findUniqueOrThrow({ where: { id: userId } });
    assert(user.active, "Cuenta desactivada.", 403);
    await tx.authAccount.upsert({ where: { providerId_accountId: { providerId: "credential", accountId: userId } }, update: { password }, create: { id: randomUUID(), providerId: "credential", accountId: userId, userId, password } });
    await tx.authSession.deleteMany({ where: { userId } });
    await audit(tx, userId, activation.purpose === "BOOTSTRAP" ? "SUPERADMIN_CREATED" : "PASSWORD_ACTIVATED", userId, { purpose: activation.purpose });
    return { email: user.email, name: user.name, role: user.role };
  }, { timeout: 15000 });
}
export async function resolveLogin(identifier: string) {
  if (identifier.includes("@")) return identifier.trim().toLowerCase();
  const employee = await db.employee.findUnique({ where: { cpid: normalizeCpid(identifier) }, include: { user: true } });
  return employee?.active && employee.user?.active ? employee.user.email : "unknown@invalid.example";
}
export async function savePlatformUser(actor: Employee, input: unknown, id?: string) {
  assert(isRh(actor), "Acceso RH requerido.", 403);
  const data = z.object({ name: z.string().trim().min(3).max(160), email: z.email(), role: z.enum(["SUPERADMIN", "RH", "SUPERVISOR", "EMPLOYEE"]), employeeId: z.string().nullable().optional(), active: z.boolean().default(true) }).parse(input);
  if (["EMPLOYEE", "SUPERVISOR"].includes(data.role)) assert(data.employeeId, "Seleccione el expediente del empleado.");
  if (data.employeeId) assert((await db.employee.findUnique({ where: { id: data.employeeId } }))?.active, "Empleado desactivado o inexistente.");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7364031)`;
    const previous = id ? await tx.platformUser.findUniqueOrThrow({ where: { id } }) : null;
    if (actor.role !== "SUPERADMIN") assert(!["RH", "SUPERADMIN"].includes(data.role) && (!previous || !["RH", "SUPERADMIN"].includes(previous.role)), "Solo superadmin administra cuentas RH y superadmin.", 403);
    if (data.employeeId) assert((await tx.employee.findUnique({where:{id:data.employeeId}}))?.active,"Empleado desactivado o inexistente.");
    if (previous?.role === "SUPERADMIN" && (!data.active || data.role !== "SUPERADMIN")) assert((await tx.platformUser.count({ where: { role: "SUPERADMIN", active: true } })) > 1, "Debe conservar al menos un superadmin activo.");
    const user = id ? await tx.platformUser.update({ where: { id }, data: { ...data, email: data.email.toLowerCase() } }) : await tx.platformUser.create({ data: { ...data, id: randomUUID(), email: data.email.toLowerCase(), emailVerified: true } });
    if (user.employeeId) await tx.employee.update({ where: { id: user.employeeId }, data: { ...(user.role!=="SUPERADMIN"?{role:user.role}:{}),email:user.email } });
    if (id) await tx.authSession.deleteMany({ where: { userId: id } });
    await audit(tx, (actor as Employee&{accountId?:string}).accountId??actor.id, id ? "ACCOUNT_UPDATED" : "ACCOUNT_CREATED", user.id, { name: user.name, email: user.email, role: user.role, active: user.active });
    return user;
  });
}
