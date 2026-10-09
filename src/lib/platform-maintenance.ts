import { db } from "./db";
import { assert } from "./domain";

export const maintenanceKey = "platformMaintenance";

export async function maintenanceActive() {
  return !!(await db.setting.findUnique({ where: { key: maintenanceKey } }));
}

export async function ensureOperational() {
  assert(!(await maintenanceActive()), "UpKeepHR está en mantenimiento. Intente de nuevo en unos minutos.", 503);
}
