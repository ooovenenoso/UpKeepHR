import { createClient } from "@supabase/supabase-js";
import { assert } from "./domain";
const buckets = new Set(["hhrr-documents", "hhrr-uploads", "hhrr-reports", "hhrr-backups"]);
export function storageClient() {
  assert(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, "Almacenamiento sin configurar.", 503);
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
function guard(bucket: string, key: string) {
  assert(buckets.has(bucket) && /^[a-zA-Z0-9_\-/\.]+$/.test(key) && !key.includes(".."), "Ruta de archivo inválida.");
}
export async function storeObject(bucket: string, key: string, bytes: Uint8Array, mime: string) {
  guard(bucket,key);
  const {error}=await storageClient().storage.from(bucket).upload(key,bytes,{contentType:mime,upsert:false});
  assert(!error,"No se pudo guardar el archivo.",503);
}
export async function getObject(bucket: string,key: string) {
  guard(bucket,key);
  const {data,error}=await storageClient().storage.from(bucket).download(key);
  assert(data && !error,"Archivo no disponible.",404);
  return Buffer.from(await data.arrayBuffer());
}
export async function removeObjects(bucket: string,keys: string[]) {
  for(const key of keys) guard(bucket,key);
  if(keys.length) { const {error}=await storageClient().storage.from(bucket).remove(keys); assert(!error,"No se pudo limpiar el almacenamiento.",503); }
}
export async function signedDownload(bucket: string,key: string,filename: string) {
  guard(bucket,key);
  const {data,error}=await storageClient().storage.from(bucket).createSignedUrl(key,60,{download:filename});
  assert(data && !error,"No se pudo abrir el archivo.",503);
  return new Response(null,{status:302,headers:{Location:data.signedUrl,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
export async function copyToBackup(source: string, destination: string) {
 guard("hhrr-documents",source); guard("hhrr-backups",destination);
 const {error}=await storageClient().storage.from("hhrr-documents").copy(source,destination,{destinationBucket:"hhrr-backups"});
 // A retry after an interrupted response can find the immutable copy already present.
 if(error) { const bytes=await getObject("hhrr-backups",destination).catch(()=>null); assert(bytes,"No se pudo respaldar el archivo.",503); }
}
