import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { cloudDirectory } from "./cloud-admin";
const { values } = parseArgs({ options: { execute: { type: "boolean", default: false }, project: { type: "string" } } });
const envFile = process.env.APP_ENV_FILE ?? path.join(cloudDirectory, "production.env");
process.loadEnvFile(envFile);
const { db } = await import("../src/lib/db");
const { databaseSchema, cloudStorage, emailEnabled } = await import("../src/lib/config");
const { clearEmployeeData } = await import("../src/lib/clear-employees");
const { maintenanceKey } = await import("../src/lib/platform-maintenance");
const { storageClient } = await import("../src/lib/object-store");
if (databaseSchema !== "public" || !cloudStorage || emailEnabled || !values.project || new URL(process.env.SUPABASE_URL!).hostname !== `${values.project}.supabase.co`)
  throw new Error("Indique el proyecto de producción correcto, Storage privado y correo deshabilitado.");
const administrator = await db.platformUser.findFirstOrThrow({ where: { role: "SUPERADMIN", active: true }, select: { id: true } });
const counts = { employees: await db.employee.count(), assignments: await db.assignment.count(), documents: await db.documentType.count(), administrativeAccounts: await db.platformUser.count({ where: { role: { in: ["SUPERADMIN", "RH"] } } }) };
console.log(JSON.stringify({ preview: true, schema: databaseSchema, ...counts }));
if (!values.execute) { await db.$disconnect(); process.exit(0); }
const client = storageClient(), buckets = ["hhrr-documents", "hhrr-uploads", "hhrr-reports", "hhrr-backups"] as const;
async function listKeys(bucket: typeof buckets[number]) {
  const keys: string[] = [], folders = [""];
  while (folders.length) {
    const prefix = folders.shift()!;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error || !data) throw new Error(`No se pudo inventariar ${bucket}.`);
      for (const item of data) {
        const key = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) keys.push(key); else folders.push(key);
      }
      if (data.length < 1000) break;
    }
  }
  return keys;
}
const owner = randomUUID(), now = new Date();
await db.lease.createMany({ data: [{ key: "scheduler", owner: "", until: new Date(0) }], skipDuplicates: true });
const acquired = await db.lease.updateMany({ where: { key: "scheduler", until: { lte: now } }, data: { owner, until: new Date(now.getTime() + 30 * 60000) } });
if (!acquired.count) { await db.$disconnect(); throw new Error("El motor aún está ejecutándose. Reintente cuando termine."); }
let complete = false;
try {
  await db.setting.upsert({ where: { key: maintenanceKey }, create: { key: maintenanceKey, value: "true" }, update: { value: "true" } });
  await new Promise(resolve => setTimeout(resolve, 60000));
  const result = await db.$transaction(tx => clearEmployeeData(tx, administrator.id), { timeout: 60000 });
  let removedObjects = 0;
  for (const bucket of buckets) {
    const keys = await listKeys(bucket);
    for (let offset = 0; offset < keys.length; offset += 100) {
      const { error } = await client.storage.from(bucket).remove(keys.slice(offset, offset + 100));
      if (error) throw new Error(`No se pudo limpiar ${bucket}. Reintente la limpieza para completar los archivos.`);
    }
    if ((await listKeys(bucket)).length) throw new Error(`Hay archivos restantes en ${bucket}.`);
    removedObjects += keys.length;
  }
  if (await db.employee.count() || await db.documentType.count() !== counts.documents || await db.platformUser.count({ where: { role: { in: ["SUPERADMIN", "RH"] } } }) !== counts.administrativeAccounts)
    throw new Error("La verificación final no coincide.");
  const proof = { ...result, employeesRemaining: 0, removedObjects, documentsRetained: counts.documents, completedAt: new Date().toISOString() };
  await fs.mkdir(cloudDirectory, { recursive: true });
  await fs.writeFile(path.join(cloudDirectory, "employee-cleanup.json"), JSON.stringify(proof));
  console.log(JSON.stringify(proof));
  complete = true;
} finally {
  if (complete) await db.setting.deleteMany({ where: { key: maintenanceKey } });
  await db.lease.updateMany({ where: { key: "scheduler", owner }, data: { until: new Date(0) } });
  await db.$disconnect();
}
