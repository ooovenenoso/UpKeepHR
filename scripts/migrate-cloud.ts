import fs from "node:fs";
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
if (process.env.APP_ENV_FILE) process.loadEnvFile(process.env.APP_ENV_FILE);
// Initial shared-project migrations are provisioned once with Management API,
// and recorded in hhrr_migrations. Runtime credentials cannot migrate other apps.
const { db } = await import("../src/lib/db");
await db.employee.count();
console.log("Conexión y tablas hhrr verificadas.");
await db.$disconnect();
