import fs from "node:fs/promises";
import path from "node:path";
import {parseArgs} from "node:util";
import {createHash,randomUUID} from "node:crypto";
import {db} from "../src/lib/db";
import {databaseSchema,cloudStorage,filesDir,emailEnabled} from "../src/lib/config";
import {assert} from "../src/lib/domain";
import {getObject,storeObject,removeObjects} from "../src/lib/object-store";
assert(databaseSchema==="hhrr_test"&&!emailEnabled,"Restauración permitida solamente en hhrr_test con correo deshabilitado.");
const {values}=parseArgs({options:{manifest:{type:"string"}}});assert(values.manifest,"Indique --manifest.");
const local=await fs.stat(values.manifest).then(s=>s.isFile()).catch(()=>false);
const manifest=JSON.parse((local?await fs.readFile(values.manifest):await getObject("hhrr-backups",values.manifest)).toString());
assert(manifest.status==="COMPLETE","El respaldo aún no terminó.");
const folder=local?path.dirname(path.resolve(values.manifest)):manifest.path;
const snapshot=JSON.parse((local?await fs.readFile(path.join(folder,"database.json")):await getObject("hhrr-backups",`${folder}/database.json`)).toString());
assert(snapshot.format==="UPKEEPHR-PG-1","Formato de respaldo incompatible.");
const models=["employee","documentType","rule","assignment","cycle","obligation","submission","attachment","challenge","session","notification","notificationEvent","webhookEvent","audit","importBatch","importRow","setting","lease","platformUser","authSession","authAccount","authVerification","twoFactor","authRateLimit","activation","uploadSession","exportJob","dailySnapshot"] as const;
assert(Object.keys(snapshot.tables).every(k=>models.includes(k as typeof models[number])),"Tablas fuera de RH.");
const schema=await fs.readFile("prisma/schema.prisma","utf8");
const definitions=new Map([...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)].map(m=>[m[1][0].toLowerCase()+m[1].slice(1),new Map([...m[2].matchAll(/^\s*(\w+)\s+(String|Int|Boolean|DateTime|BigInt|Float|Decimal|Json)\??\s/gm)].map(f=>[f[1],f[2]]))]));
const copied:string[]=[];
try {
 for(const attachment of snapshot.tables.attachment as {storageKey:string;sha256:string;mime:string}[]) {
  assert(/^[a-zA-Z0-9_\-/\.]+$/.test(attachment.storageKey)&&!attachment.storageKey.includes(".."),"Ruta inválida.");
  const bytes=local?await fs.readFile(path.join(folder,"files",attachment.storageKey)):await getObject("hhrr-backups",`${folder}/files/${attachment.storageKey}`);
  assert(bytes.length<=10*1024*1024&&createHash("sha256").update(bytes).digest("hex")===attachment.sha256,"Archivo del respaldo inconsistente.");
  const key=randomUUID();if(cloudStorage)await storeObject("hhrr-documents",key,bytes,attachment.mime);else{await fs.mkdir(filesDir,{recursive:true});await fs.writeFile(path.join(filesDir,key),bytes,{flag:"wx"});}copied.push(key);attachment.storageKey=key;
 }
 await db.$transaction(async tx=>{
  for(const model of [...models].reverse())await (tx[model] as {deleteMany:()=>Promise<unknown>}).deleteMany();
  for(const model of models){const definition=definitions.get(model)!;const data=snapshot.tables[model].map((row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).map(([key,value])=>{const type=definition.get(key);assert(type,"Campo inesperado.");return [key,value===null?null:type==="DateTime"?new Date(String(value)):type==="BigInt"?BigInt(String(value)):value];})));if(data.length)await (tx[model] as unknown as {createMany:(args:{data:unknown[]})=>Promise<unknown>}).createMany({data});}
  // Restored sessions/one-use links are invalidated in the test environment.
  await tx.authSession.deleteMany();await tx.session.deleteMany();await tx.activation.deleteMany();
 },{timeout:60000});
 console.log(`Respaldo verificado y restaurado exclusivamente en hhrr_test: ${copied.length} archivo(s).`);
}catch(error){if(cloudStorage)await removeObjects("hhrr-documents",copied);throw error;}finally{await db.$disconnect();}
