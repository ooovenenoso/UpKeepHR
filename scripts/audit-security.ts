import {readCloudState} from "./cloud-admin";
const ref=process.env.SUPABASE_PROJECT_REF??readCloudState().supabaseProjectRef;
if(!ref||!/^[a-z0-9]+$/.test(ref))throw new Error("Configure el proyecto Supabase.");
const query=`SELECT c.relname,c.relrowsecurity AS rls,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS anon_access,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS authenticated_access
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'hhrr_%'`;
async function sql(query:string){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:"POST",headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({query})});if(!r.ok)throw new Error("No se pudo auditar seguridad.");return r.json();}
const tables=await sql(query);
if(tables.length!==29||tables.some((t:{rls:boolean;anon_access:boolean;authenticated_access:boolean})=>!t.rls||t.anon_access||t.authenticated_access))throw new Error("Tabla RH expuesta o sin RLS.");
const roles=await sql("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='hhrr_app'");
if(roles.length!==1||Object.values(roles[0]).some(Boolean))throw new Error("El runtime tiene privilegios excesivos.");
const isolation=await sql("SELECT count(*)::int AS accessible FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'hhrr_%' AND has_table_privilege('hhrr_app',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE')");
if(isolation[0].accessible!==0)throw new Error("El runtime accede a otros proyectos.");
console.log(JSON.stringify({tables:tables.length,rls:"verified",publicAccess:"denied",runtimeBypass:"denied",otherProjects:"isolated"}));
