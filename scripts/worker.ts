import { tick } from "../src/lib/worker";
import { db } from "../src/lib/db";
let busy = false;
async function run() {
  if (busy) return;
  busy = true;
  try {
    await tick();
    console.log(`[RH] Motor actualizado ${new Date().toISOString()}`);
  } catch (e) {
    console.error("[RH] Motor:", e instanceof Error ? e.message : e);
  } finally {
    busy = false;
  }
}
await run();
const interval = setInterval(run, 60000);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    clearInterval(interval);
    await db.$disconnect();
    process.exit(0);
  });
