import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { cloudDirectory,readCloudState } from "./cloud-admin";
const stateDir = cloudDirectory;
await fs.mkdir(stateDir, { recursive: true });
const cloudEnvPath = path.join(stateDir, "production.env");
let saved = readCloudState();
const ref = process.env.SUPABASE_PROJECT_REF ?? saved.supabaseProjectRef;
const team = process.env.VERCEL_TEAM_ID ?? saved.teamId;
const projectName = process.env.VERCEL_PROJECT_NAME ?? saved.projectName ?? "upkeephr";
const repository = process.env.GITHUB_REPOSITORY ?? saved.repository;
if (!ref || !team || !repository || !/^[a-z0-9]+$/.test(ref) || !/^[a-z0-9-]+$/.test(projectName) || !/^[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw new Error("Configure SUPABASE_PROJECT_REF, VERCEL_TEAM_ID y GITHUB_REPOSITORY.");
async function api(base: string, route: string, token: string, body?: unknown, method = body ? "POST" : "GET") {
  const r = await fetch(base + route, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "UpKeepHR" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
  if (!r.ok) { const detail = (await r.text()).replace(/PASSWORD\s+'[^']*'/gi,"PASSWORD [redacted]").replace(/[A-Za-z0-9_+.-]{32,}/g,"[redacted]"); throw new Error(`API ${route.split('?')[0]}: HTTP ${r.status}: ${detail.slice(0,700)}`); }
  return r.json();
}
const sb = (route: string, body?: unknown) => api("https://api.supabase.com", `/v1/projects/${ref}${route}`, process.env.SUPABASE_ACCESS_TOKEN!, body);
const sql = (query: string) => sb("/database/query", { query });
const quote = (v: string) => "'" + v.replaceAll("'", "''") + "'";
const rolePassword = saved.rolePassword ?? randomBytes(32).toString("hex");
const testPassword = saved.testPassword ?? randomBytes(32).toString("hex");
const secret = saved.secret ?? randomBytes(48).toString("hex");
const cron = saved.cron ?? randomBytes(32).toString("hex");
saved = { ...saved, rolePassword, testPassword, secret, cron };
await fs.writeFile(path.join(stateDir, "provision-state.json"), JSON.stringify(saved), { mode: 0o600 });
// No global password resets, privileges, Auth configuration or shared schema migrations.
await sql(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='hhrr_app') THEN CREATE ROLE hhrr_app LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${quote(rolePassword)}; END IF; IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='hhrr_test_runner') THEN CREATE ROLE hhrr_test_runner LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${quote(testPassword)}; END IF; END $$; GRANT hhrr_test_runner TO postgres; GRANT USAGE ON SCHEMA public TO hhrr_app; CREATE SCHEMA IF NOT EXISTS hhrr_test AUTHORIZATION hhrr_test_runner;`);
let ddl = await fs.readFile("prisma/cloud/001-initial.sql", "utf8");
ddl = ddl.replace('CREATE SCHEMA IF NOT EXISTS "public";', "");
const tables = [...ddl.matchAll(/CREATE TABLE "(hhrr_[a-z_]+)"/g)].map(x => x[1]);
if (!tables.length || /CREATE TABLE "(?!hhrr_)/.test(ddl)) throw new Error("Migration includes an unexpected table.");
const hash = createHash("sha256").update(ddl).digest("hex");
await sql(`CREATE TABLE IF NOT EXISTS public.hhrr_migrations (id text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON public.hhrr_migrations FROM anon, authenticated; ALTER TABLE public.hhrr_migrations ENABLE ROW LEVEL SECURITY;`);
const existing = await sql("SELECT id, hash FROM public.hhrr_migrations WHERE id='001-initial'");
if (!existing.length) {
  const policies = tables.map(t => `REVOKE ALL ON public."${t}" FROM anon, authenticated; ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT,UPDATE,DELETE ON public."${t}" TO hhrr_app; CREATE POLICY hhrr_app_access ON public."${t}" TO hhrr_app USING(true) WITH CHECK(true);`).join("\n");
  await sql(`BEGIN; ${ddl} ${policies} INSERT INTO public.hhrr_migrations(id,hash) VALUES('001-initial',${quote(hash)}); COMMIT;`);
} else if (existing[0].hash !== hash) throw new Error("Applied initial migration differs. Add a new migration; do not overwrite it.");
const testExists = await sql("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='hhrr_test' AND tablename='hhrr_employees'");
if (!testExists.length) await sql(`BEGIN; SET LOCAL search_path TO hhrr_test; ${ddl} ${tables.map(t=>`ALTER TABLE hhrr_test."${t}" OWNER TO hhrr_test_runner;`).join('\n')} COMMIT;`);
for(const file of (await fs.readdir("prisma/cloud")).filter(f=>/^00[2-9].*\.sql$/.test(f)).sort()) {
 const migration=await fs.readFile(`prisma/cloud/${file}`,"utf8"),digest=createHash("sha256").update(migration).digest("hex");
 if(/DROP\s+(TABLE|SCHEMA|DATABASE)|\b(?!hhrr_)\w+\.\w+/i.test(migration)) throw new Error("Unexpected destructive/shared migration.");
 for(const schema of ["public","hhrr_test"]) {
  const id=`${file}:${schema}`,applied=await sql(`SELECT hash FROM public.hhrr_migrations WHERE id=${quote(id)}`);
  if(applied.length){if(applied[0].hash!==digest)throw new Error("Applied migration changed.");continue;}
  await sql(`BEGIN; SET LOCAL search_path TO ${schema}; ${migration} INSERT INTO public.hhrr_migrations(id,hash) VALUES(${quote(id)},${quote(digest)}); COMMIT;`);
 }
}
const configs = await sb("/config/database/pooler");
const conf = configs.find((x: { pool_mode: string }) => x.pool_mode === "transaction") ?? configs[0];
const template = new URL(conf.connection_string);
const dbUrl = (role: string, password: string) => {
  const u = new URL(template); u.username = `${role}.${ref}`; u.password = password; u.port = "6543"; return u.toString();
};
const keys = await sb("/api-keys");
const serviceKey = keys.find((x: { id: string; name: string }) => x.id === "service_role" || x.name === "service_role")?.api_key;
if (!serviceKey) throw new Error("Storage server credential unavailable.");
const storage = createClient(`https://${ref}.supabase.co`, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: buckets, error: bucketError } = await storage.storage.listBuckets();
if (bucketError) throw new Error("Cannot inventory storage buckets.");
for (const name of ["hhrr-documents", "hhrr-uploads", "hhrr-reports", "hhrr-backups"]) {
  if (buckets?.some(b=>b.id===name)) continue;
  const { error } = await storage.storage.createBucket(name, { public: false, fileSizeLimit: name === "hhrr-documents" || name === "hhrr-uploads" ? 10*1024*1024 : 50*1024*1024 });
  if (error) throw new Error(`Cannot create ${name}.`);
}
const env = {
  APP_MODE: "cloud", APP_URL: process.env.PRODUCTION_APP_URL ?? saved.appUrl ?? `https://${projectName}.vercel.app`, DATA_PROFILE: "production", DATABASE_URL: dbUrl("hhrr_app",rolePassword), DATABASE_SCHEMA: "public",
  BETTER_AUTH_SECRET: secret, AUTH_SECRET: secret, CRON_SECRET: cron, EMAIL_ENABLED: "false", EMAIL_PROVIDER: "disabled", STORAGE_PROVIDER: "supabase", SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: serviceKey,
};
const encodeEnv = (values: Record<string,string>) => Object.entries(values).map(([k,v])=>`${k}=${v}`).join("\n")+"\n";
await fs.writeFile(cloudEnvPath, encodeEnv(env), { mode: 0o600 });
await fs.writeFile(path.join(stateDir,"development.env"), encodeEnv({...env,APP_MODE:"local",APP_URL:"http://127.0.0.1:3000",DATA_PROFILE:"test",DATABASE_URL:dbUrl("hhrr_test_runner",testPassword),DATABASE_SCHEMA:"hhrr_test"}),{mode:0o600});
await fs.writeFile(".env.local", `APP_ENV_FILE=${path.join(stateDir,"development.env").replaceAll('\\','/')}\n`);
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, ssl:{ca:await fs.readFile("certs/supabase-ca.crt","utf8"),rejectUnauthorized:true} });
await pool.query('SELECT count(*) FROM public.hhrr_employees');
const isolation = await pool.query("SELECT count(*) AS accessible FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'hhrr_%' AND has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'SELECT')");
if (Number(isolation.rows[0].accessible)) throw new Error("Runtime role can access unrelated tables.");
await pool.end();
const ghUrl = "https://api.github.com";
let repo;
try { repo=await api(ghUrl,`/repos/${repository}`,process.env.GITHUB_ACCESS_TOKEN!); }
catch(error) { if (!String(error).includes('404')) throw error; repo=await api(ghUrl,"/user/repos",process.env.GITHUB_ACCESS_TOKEN!,{name:repository.split("/")[1],private:true,description:"UpKeepHR — Documentación y cumplimiento RH",auto_init:false}); }
if (!repo.private) throw new Error("Repository must be private.");
let project;
try { project=await api("https://api.vercel.com",`/v9/projects/${saved.projectId ?? projectName}?teamId=${team}`,process.env.VERCEL_ACCESS_TOKEN!); }
catch(error) { if(!String(error).includes('404')) throw error; project=await api("https://api.vercel.com",`/v11/projects?teamId=${team}`,process.env.VERCEL_ACCESS_TOKEN!,{name:projectName,framework:"nextjs",gitRepository:{type:"github",repo:repository}}); }
for (const [key,value] of Object.entries(env)) await api("https://api.vercel.com",`/v10/projects/${project.id}/env?teamId=${team}&upsert=true`,process.env.VERCEL_ACCESS_TOKEN!,{key,value,type:"encrypted",target:["production"]});
saved = {...saved,repoId:String(repo.id),projectId:project.id,supabaseProjectRef:ref,teamId:team,projectName,repository,appUrl:env.APP_URL};
await fs.writeFile(path.join(stateDir,"provision-state.json"),JSON.stringify(saved),{mode:0o600});
console.log(JSON.stringify({repository:repo.html_url,private:repo.private,project:project.name,tables:tables.length,buckets:4,runtimeIsolation:"verified",secretsDirectory:stateDir}));
