import { defineConfig } from "prisma/config";
import { databaseUrl } from "./src/lib/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  // Cloud migrations are applied by the scoped provision script, not Prisma migrate.
  datasource: { url: databaseUrl },
});
