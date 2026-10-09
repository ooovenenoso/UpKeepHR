import { createBackup } from "../src/lib/backup";
import { db } from "../src/lib/db";
console.log(await createBackup());
await db.$disconnect();
