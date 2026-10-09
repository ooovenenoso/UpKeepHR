import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrl, databaseSchema } from "./config";
import fs from "node:fs";
import path from "node:path";
const connection=new URL(databaseUrl);
const supabaseHost=connection.hostname.endsWith(".pooler.supabase.com")||connection.hostname.endsWith(".supabase.co");
if(supabaseHost){connection.searchParams.delete("sslmode");connection.searchParams.delete("sslrootcert");}
const ssl=supabaseHost?{ca:fs.readFileSync(path.join(process.cwd(),"certs/supabase-ca.crt"),"utf8"),rejectUnauthorized:true}:undefined;
const globalDb = globalThis as unknown as { rhDb?: PrismaClient };
export const db =
  globalDb.rhDb ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: connection.toString(), ssl, max: 3, connectionTimeoutMillis: 15000, idleTimeoutMillis: 20000 }, { schema: databaseSchema }),
  });
if (process.env.NODE_ENV !== "production") globalDb.rhDb = db;
export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
