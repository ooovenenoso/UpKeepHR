import { randomUUID } from "node:crypto";
import { db } from "./db";
import { generateCycle } from "./compliance";
import { processOutbox, prepareScheduledMessages } from "./mail";
import { localDate } from "./domain";
import { createBackup } from "./logical-backup";
import { recordDailySnapshot } from "./dashboard";
import { cleanUploads } from "./cloud-upload";
import { cloudStorage,emailProvider } from "./config";
import { maintenanceActive } from "./platform-maintenance";
export async function tick(now = new Date()) {
  if (await maintenanceActive()) return { skipped: true };
  const owner = randomUUID();
  await db.lease.createMany({data:[{key:"scheduler",owner:"",until:new Date(0)}],skipDuplicates:true});
  const lease = await db.lease.findUniqueOrThrow({where:{key:"scheduler"}});
  if (lease.until > now) return { skipped: true };
  const acquired = await db.lease.updateMany({
    where: { key: "scheduler", until: { lte: now } },
    data: { owner, until: new Date(now.getTime() + 10 * 60000) },
  });
  if (!acquired.count) return { skipped: true };
  try {
    const cursor = await db.setting.findUnique({where:{key:"cycleCursor"}});
    const cursorId = cursor ? JSON.parse(cursor.value) as string | null : null;
    const cycles = await db.cycle.findMany({
      where: { active: true, verified: true, employee: { active: true } },
      include: { rule: true },
      orderBy:{id:"asc"},take:25,...(cursorId?{cursor:{id:cursorId},skip:1}:{}),
    });
    for (const c of cycles)
      await db.$transaction((tx) =>
        generateCycle(tx, c, c.rule, localDate(now)),
      );
    await db.setting.upsert({where:{key:"cycleCursor"},create:{key:"cycleCursor",value:JSON.stringify(cycles.length===25?cycles.at(-1)!.id:null)},update:{value:JSON.stringify(cycles.length===25?cycles.at(-1)!.id:null)}});
    await prepareScheduledMessages(now);
    await processOutbox(now, async () => {
      await db.lease.updateMany({
        where: { key: "scheduler", owner },
        data: {
          until: new Date(Math.max(now.getTime(), Date.now()) + 10 * 60000),
        },
      });
    });
    const backup = await db.setting.findUnique({
      where: { key: "lastBackup" },
    });
    if (!backup || JSON.parse(backup.value).date !== localDate(now))
      await createBackup(now);
    const snapshot=await db.dailySnapshot.findUnique({where:{date:localDate(now)}});
    if(!snapshot||Date.now()-snapshot.createdAt.getTime()>15*60000) await recordDailySnapshot(now);
    if(cloudStorage) await cleanUploads();
    const heartbeat = {
      finishedAt: now.toISOString(),
      error: null,
      provider: emailProvider,
    };
    await db.setting.upsert({
      where: { key: "heartbeat" },
      update: { value: JSON.stringify(heartbeat) },
      create: { key: "heartbeat", value: JSON.stringify(heartbeat) },
    });
    return heartbeat;
  } catch (error) {
    const message = "El motor encontró un error. Consulte los registros protegidos del servidor.";
    await db.setting.upsert({
      where: { key: "heartbeat" },
      update: {
        value: JSON.stringify({
          finishedAt: now.toISOString(),
          error: message,
        }),
      },
      create: {
        key: "heartbeat",
        value: JSON.stringify({
          finishedAt: now.toISOString(),
          error: message,
        }),
      },
    });
    throw error;
  } finally {
    await db.lease.updateMany({
      where: { key: "scheduler", owner },
      data: { until: new Date(0) },
    });
  }
}
