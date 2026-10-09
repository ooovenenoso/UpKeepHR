import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {db} from "./db";
import {Prisma} from "../generated/prisma/client";
import {cloudStorage,backupDir,filesDir,databaseSchema} from "./config";
import {localDate} from "./domain";
import {storeObject,copyToBackup} from "./object-store";
const models=["employee","documentType","rule","assignment","cycle","obligation","submission","attachment","challenge","session","notification","notificationEvent","webhookEvent","audit","importBatch","importRow","setting","lease","platformUser","authSession","authAccount","authVerification","twoFactor","authRateLimit","activation","uploadSession","exportJob","dailySnapshot"] as const;
export async function databaseSnapshot() {
 return db.$transaction(async tx=>{
  const tables:Record<string,unknown[]>= {};
  for(const model of models) tables[model]=await (tx[model] as {findMany:()=>Promise<unknown[]>}).findMany();
  return {format:"UPKEEPHR-PG-1",schema:databaseSchema,createdAt:new Date().toISOString(),tables};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:25000});
}
type Progress={date:string;createdAt:string;path:string;pending:string[];copied:number;status:string};
async function setting(key:string,value:unknown) {const data={value:JSON.stringify(value)};await db.setting.upsert({where:{key},create:{key,...data},update:data});}
export async function createBackup(now=new Date()) {
 if(!cloudStorage) {
  const dir=path.join(backupDir,randomUUID());await fs.mkdir(dir,{recursive:true});
  const snapshot=await databaseSnapshot();await fs.writeFile(path.join(dir,"database.json"),JSON.stringify(snapshot,(_,v)=>typeof v==="bigint"?v.toString():v));
  await fs.cp(filesDir,path.join(dir,"files"),{recursive:true});
  const info={date:localDate(now),createdAt:now.toISOString(),path:dir,status:"COMPLETE"};
  await fs.writeFile(path.join(dir,"manifest.json"),JSON.stringify(info));await setting("lastBackup",info);return info;
 }
 let progress:Progress|undefined;
 const previous=await db.setting.findUnique({where:{key:"backupProgress"}});
 if(previous)progress=JSON.parse(previous.value);
 if(!progress||progress.status==="COMPLETE") {
  const snapshot=await databaseSnapshot(),prefix=`${databaseSchema}/${localDate(now)}/${randomUUID()}`;
  const attachments=snapshot.tables.attachment as {storageKey:string}[];
  await storeObject("hhrr-backups",`${prefix}/database.json`,Buffer.from(JSON.stringify(snapshot,(_,v)=>typeof v==="bigint"?v.toString():v)),"application/json");
  progress={date:localDate(now),createdAt:now.toISOString(),path:prefix,pending:attachments.map(a=>a.storageKey),copied:0,status:"COPYING"};await setting("backupProgress",progress);
 }
 for(const key of progress.pending.slice(0,5)) {
  await copyToBackup(key,`${progress.path}/files/${key}`);progress.pending.shift();progress.copied++;await setting("backupProgress",progress);
 }
 if(!progress.pending.length) {
  progress.status="COMPLETE";await storeObject("hhrr-backups",`${progress.path}/manifest.json`,Buffer.from(JSON.stringify(progress)),"application/json");
  await setting("backupProgress",progress);await setting("lastBackup",{...progress,pending:undefined});
 }
 return {...progress,pending:progress.pending.length};
}
