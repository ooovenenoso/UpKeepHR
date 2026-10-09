import type { Tx } from "./db";
import { assert } from "./domain";

// This is an explicit administrative reset, never invoked by the application or seed.
// Every delegate is restricted to the configured RH schema and hhrr_ tables.
export async function clearEmployeeData(tx: Tx, administratorId: string) {
  const administrator = await tx.platformUser.findUnique({ where: { id: administratorId } });
  assert(administrator?.active && administrator.role === "SUPERADMIN", "Se requiere un superadmin activo.", 403);
  const removedEmployees = await tx.employee.count();
  const admins = await tx.platformUser.findMany({ where: { role: { in: ["SUPERADMIN", "RH"] } }, select: { id: true } });
  await tx.platformUser.updateMany({ where: { role: { in: ["SUPERADMIN", "RH"] }, employeeId: { not: null } }, data: { employeeId: null } });
  await tx.activation.deleteMany();
  await tx.authVerification.deleteMany();
  await tx.authRateLimit.deleteMany();
  await tx.platformUser.deleteMany({ where: { role: { notIn: ["SUPERADMIN", "RH"] } } });
  for (const model of [
    "notificationEvent", "webhookEvent", "notification", "attachment", "submission",
    "obligation", "cycle", "assignment", "session", "challenge", "importRow", "importBatch",
    "uploadSession", "exportJob", "dailySnapshot", "audit",
  ] as const) await (tx[model] as { deleteMany: () => Promise<unknown> }).deleteMany();
  await tx.employee.deleteMany();
  await tx.setting.deleteMany({ where: { key: { in: ["cycleCursor", "heartbeat", "lastBackup", "backupProgress"] } } });
  assert(await tx.employee.count() === 0, "La limpieza no terminó.");
  assert(await tx.platformUser.count() === admins.length, "La limpieza alteró el acceso administrativo.");
  await tx.audit.create({ data: {
    actorId: administratorId, action: "EMPLOYEE_DATA_CLEARED", entityId: "platform",
    detail: JSON.stringify({ removedEmployees, retainedAdministrativeAccounts: admins.length }),
  } });
  return { removedEmployees, retainedAdministrativeAccounts: admins.length };
}
