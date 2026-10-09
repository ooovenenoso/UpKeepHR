import test, { beforeEach, after } from "node:test";
import nodeAssert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { NextRequest } from "next/server";

if (process.env.DATABASE_URL) {}
else if (process.env.APP_ENV_FILE) process.loadEnvFile(process.env.APP_ENV_FILE);
else {if (!process.env.DATABASE_URL) {process.loadEnvFile(".env.local");process.loadEnvFile(process.env.APP_ENV_FILE!);}}
if (process.env.DATABASE_SCHEMA !== "hhrr_test") throw new Error("Tests only run in hhrr_test.");
const root = path.resolve(os.tmpdir(), `upkeephr-test-${randomUUID()}`);
process.env.DATA_DIR = root;
process.env.EMAIL_PROVIDER = "preview";
process.env.EMAIL_ENABLED = "false";
process.env.STORAGE_PROVIDER = "local";
process.env.ALLOW_LEGACY_TEST_SESSION = "true";
process.env.APP_MODE = "local";
await fs.mkdir(root, { recursive: true });
const { db } = await import("../src/lib/db");
const { localDate, addDays, addMonths, validDate, currentStage, stateOf } =
  await import("../src/lib/domain");
const {
  saveDocument,
  saveEmployee,
  assign,
  reviewSubmission,
  ruleApplicationPreview,
  applyCurrentRule,
} = await import("../src/lib/compliance");
const { submitFiles, readAttachment } = await import("../src/lib/storage");
const { requestCode, verifyCode, localhostOnly } =
  await import("../src/lib/auth");
const { prepareScheduledMessages, processOutbox, deliverMessage } =
  await import("../src/lib/mail");
const { tick } = await import("../src/lib/worker");
const { createBackup } = await import("../src/lib/backup");
const { previewImport, commitImport, fixImportRow, verifyImportedLaw } =
  await import("../src/lib/importer");
const { reportRows, exportReport } = await import("../src/lib/reports");
const { recordProviderEvent, reconcileProviderEvents } =
  await import("../src/lib/provider-events");
type Employee = Awaited<ReturnType<typeof db.employee.create>>;
let rh: Employee, supervisor: Employee, employee: Employee, foreign: Employee;
let health: string, law: string, police: string;
const today = localDate();
test("la limpieza elimina expedientes y conserva credenciales, MFA, sesiones administrativas y reglas", async () => {
  const { clearEmployeeData } = await import("../src/lib/clear-employees");
  const { ensureOperational, maintenanceKey } = await import("../src/lib/platform-maintenance");
  await nodeAssert.rejects(() => db.$transaction(tx => clearEmployeeData(tx, "unknown")));
  nodeAssert.equal(await db.employee.count(), 4);
  const admin = await db.platformUser.create({ data: { id: randomUUID(), name: "Admin de prueba", email: "admin@example.test", role: "SUPERADMIN", twoFactorEnabled: true, employeeId: rh.id } });
  const staff = await db.platformUser.create({ data: { id: randomUUID(), name: "RH de prueba", email: "staff@example.test", role: "RH" } });
  const account = await db.authAccount.create({ data: { id: randomUUID(), userId: admin.id, accountId: admin.id, providerId: "credential", password: "preserved-test-hash" } });
  const mfa = await db.twoFactor.create({ data: { id: randomUUID(), userId: admin.id, secret: "encrypted-test-secret", backupCodes: "encrypted-test-codes", verified: true } });
  const session = await db.authSession.create({ data: { id: randomUUID(), token: randomUUID(), userId: admin.id, expiresAt: new Date(Date.now() + 60000) } });
  const portal = await db.platformUser.create({ data: { id: randomUUID(), name: employee.name, email: employee.email, role: "EMPLOYEE", employeeId: employee.id } });
  await db.authSession.create({ data: { id: randomUUID(), token: randomUUID(), userId: portal.id, expiresAt: new Date(Date.now() + 60000) } });
  await initial();
  const batch = await db.importBatch.create({ data: { filename: "test.xlsx", hash: randomUUID() } });
  await db.importRow.create({ data: { batchId: batch.id, rowNumber: 2, payload: JSON.stringify({ name: employee.name }), issues: "[]", employeeId: employee.id } });
  await db.dailySnapshot.create({ data: { date: today, metrics: JSON.stringify([{ employeeId: employee.id }]) } });
  await db.exportJob.create({ data: { actorId: admin.id, filename: "test.pdf", storageKey: "test/report", mime: "application/pdf", filters: "{}", rowCount: 1 } });
  const docs = await db.documentType.findMany({ orderBy: { id: "asc" } }), rules = await db.rule.findMany({ orderBy: { id: "asc" } });
  await db.setting.create({ data: { key: maintenanceKey, value: "true" } });
  await nodeAssert.rejects(ensureOperational, /mantenimiento/);
  nodeAssert.deepEqual(await tick(), { skipped: true });
  const result = await db.$transaction(tx => clearEmployeeData(tx, admin.id));
  nodeAssert.deepEqual(result, { removedEmployees: 4, retainedAdministrativeAccounts: 2 });
  nodeAssert.equal(await db.employee.count(), 0);
  for (const model of ["assignment", "obligation", "cycle", "submission", "attachment", "importBatch", "importRow", "notification", "notificationEvent", "uploadSession", "exportJob", "dailySnapshot", "challenge", "session"] as const) nodeAssert.equal(await (db[model] as { count: () => Promise<number> }).count(), 0);
  nodeAssert.deepEqual(await db.documentType.findMany({ orderBy: { id: "asc" } }), docs);
  nodeAssert.deepEqual(await db.rule.findMany({ orderBy: { id: "asc" } }), rules);
  nodeAssert.deepEqual(await db.authAccount.findUnique({ where: { id: account.id } }), account);
  nodeAssert.deepEqual(await db.twoFactor.findUnique({ where: { id: mfa.id } }), mfa);
  nodeAssert.deepEqual(await db.authSession.findUnique({ where: { id: session.id } }), session);
  nodeAssert.equal(await db.authSession.count(), 1);
  nodeAssert.equal((await db.platformUser.findUniqueOrThrow({ where: { id: admin.id } })).employeeId, null);
  nodeAssert.deepEqual(await db.platformUser.findUnique({ where: { id: staff.id } }), staff);
  nodeAssert.equal(await db.platformUser.findUnique({ where: { id: portal.id } }), null);
  const again = await db.$transaction(tx => clearEmployeeData(tx, admin.id));
  nodeAssert.equal(again.removedEmployees, 0);
  nodeAssert.equal(await db.audit.count(), 1);
  await db.setting.delete({ where: { key: maintenanceKey } });
  await ensureOperational();
});
const at = (date: string) => new Date(`${date}T13:00:00-00:00`);
const ruleBody = (name = "Salud") => ({
  name,
  description: "Prueba de requisito",
  instructions: "Entregar un certificado.",
  autoAssign: false,
  expiryMode: "PROVIDED",
  validityMonths: 12,
  initialDays: 30,
  calendarMode: "CLAMP",
  reviewMonths: null,
  reviewCount: null,
  reviewTargetId: null,
  reminders: [10, 5, 0],
  overdueDays: 7,
  sites: [],
  positions: [],
});
beforeEach(async () => {
  for (const model of [
    "notificationEvent",
    "webhookEvent",
    "notification",
    "attachment",
    "submission",
    "obligation",
    "cycle",
    "assignment",
    "rule",
    "documentType",
    "session",
    "challenge",
    "audit",
    "importRow",
    "importBatch",
    "activation",
    "authSession",
    "authAccount",
    "twoFactor",
    "platformUser",
    "authVerification",
    "authRateLimit",
    "uploadSession",
    "exportJob",
    "dailySnapshot",
    "employee",
    "setting",
    "lease",
  ] as const)
    await (db[model] as { deleteMany: () => Promise<unknown> }).deleteMany();
  const base = {
    site: "CAGUAS",
    position: "Maestra",
    hireDate: today,
    source: "DEMO",
  };
  rh = await db.employee.create({
    data: {
      ...base,
      cpid: "RH",
      name: "Recursos Humanos",
      lastNames: "Humanos",
      email: "rh@example.test",
      role: "RH",
    },
  });
  supervisor = await db.employee.create({
    data: {
      ...base,
      cpid: "SUP",
      name: "Supervisora Demo",
      lastNames: "Demo",
      email: "super@example.test",
      role: "SUPERVISOR",
    },
  });
  employee = await db.employee.create({
    data: {
      ...base,
      cpid: "E1",
      name: "Ana López",
      lastNames: "López",
      email: "ana@example.test",
      supervisorId: supervisor.id,
    },
  });
  foreign = await db.employee.create({
    data: {
      ...base,
      cpid: "E2",
      name: "Luis Pérez",
      lastNames: "Pérez",
      email: "luis@example.test",
    },
  });
  health = (await saveDocument(rh, ruleBody())).id;
  police = (
    await saveDocument(rh, {
      ...ruleBody("Antecedentes"),
      expiryMode: "NONE",
      validityMonths: null,
    })
  ).id;
  law = (
    await saveDocument(rh, {
      ...ruleBody("Ley 300"),
      expiryMode: "FROM_ISSUE",
      validityMonths: 60,
      calendarMode: "ANNIVERSARY",
      reviewMonths: 12,
      reviewCount: 4,
      reviewTargetId: police,
    })
  ).id;
  await db.documentType.update({
    where: { id: health },
    data: { code: "SALUD" },
  });
  await db.documentType.update({
    where: { id: law },
    data: { code: "LEY300" },
  });
});
after(async () => {
  await db.$disconnect();
  const target = path.resolve(root),
    tmp = path.resolve(os.tmpdir());
  nodeAssert.equal(path.dirname(target), tmp);
  nodeAssert.ok(path.basename(target).startsWith("upkeephr-test-"));
  await fs.rm(target, { recursive: true, force: true });
});
async function initial(
  documentTypeId = health,
  due = addDays(today, 30),
  person = employee,
) {
  await db.$transaction((tx) => assign(tx, person, documentTypeId, due));
  return db.obligation.findFirstOrThrow({
    where: { employeeId: person.id, documentTypeId, kind: "INITIAL" },
  });
}
async function pdf() {
  const p = await PDFDocument.create();
  p.addPage().drawText("Certificado de prueba RH");
  return new File([new Uint8Array(await p.save())], "certificado.pdf", {
    type: "application/pdf",
  });
}
async function upload(
  obligationId: string,
  person = employee,
  issue = addMonths(today, -1),
  expires = addMonths(today, 11),
) {
  const form = new FormData();
  form.set("obligationId", obligationId);
  form.set("issueDate", issue);
  form.set("expiresDate", expires);
  form.append("files", await pdf());
  return submitFiles(person, form);
}
test("Calendar preserves annual leap overflow, month-end clamp and strict dates", () => {
  nodeAssert.equal(addMonths("2024-02-29", 12, "ANNIVERSARY"), "2025-03-01");
  nodeAssert.equal(addMonths("2024-02-29", 60, "ANNIVERSARY"), "2029-03-01");
  nodeAssert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  nodeAssert.equal(validDate("2026-02-30"), false);
  for (const [days, stage] of [
    [11, null],
    [10, "D10"],
    [6, "D10"],
    [5, "D5"],
    [1, "D5"],
    [0, "D0"],
    [-1, "D0"],
    [-7, "W1"],
    [-14, "W2"],
  ] as const)
    nodeAssert.equal(
      currentStage(addDays(today, days), today, [10, 5, 0], 7),
      stage,
    );
  nodeAssert.equal(stateOf({ status: "OPEN", dueDate: today }), "VENCE_HOY");
});
test("Ley 300 approves the initial bundle, creates three later checks and repeats on complete renewal", async () => {
  const o = await initial(law),
    issue = addMonths(today, -12, "ANNIVERSARY");
  const s = await upload(o.id, employee, issue);
  await nodeAssert.rejects(()=>reviewSubmission(rh,s.id,{approve:true}),/antecedentes penales/);
  nodeAssert.equal(await db.cycle.count(),0);
  await reviewSubmission(rh, s.id, { approve: true, initialBackgroundConfirmed:true });
  const cycle = await db.cycle.findFirstOrThrow({
    where: { documentTypeId: law, active: true },
  });
  const annual = await db.obligation.findMany({
    where: { cycleId: cycle.id, kind: "REVIEW" },
    orderBy: { reviewIndex: "asc" },
  });
  nodeAssert.deepEqual(
    annual.map((o) => o.dueDate),
    [12, 24, 36].map((m) => addMonths(issue, m, "ANNIVERSARY")),
  );
  nodeAssert.deepEqual(annual.map(o=>o.reviewIndex),[2,3,4]);
  const current=await (await import("../src/lib/dashboard")).currentRequirements(rh,new URLSearchParams({employee:employee.id,document:law}));
  nodeAssert.equal(current[0].law!.periods[0].deliveredDate,today);
  nodeAssert.equal(current[0].law!.periods[0].dueDate,today);
  nodeAssert.equal(current[0].law!.periods[0].state,"APROBADA");
  const annualUpload = await upload(annual[0].id);
  await reviewSubmission(rh, annualUpload.id, { approve: true });
  nodeAssert.equal(
    await db.obligation.count({
      where: { cycleId: cycle.id, kind: "REVIEW", status: "OPEN" },
    }),
    2,
  );
  const renewal = await db.obligation.findFirstOrThrow({
    where: { cycleId: cycle.id, kind: "RENEWAL" },
  });
  const replacement = await upload(renewal.id, employee, today);
  await reviewSubmission(rh, replacement.id, { approve: true, initialBackgroundConfirmed:true });
  nodeAssert.equal(
    (await db.cycle.findUniqueOrThrow({ where: { id: cycle.id } })).active,
    false,
  );
  nodeAssert.equal(
    await db.obligation.count({ where: { cycleId: cycle.id, status: "OPEN" } }),
    0,
  );
  nodeAssert.equal(
    await db.obligation.count({
      where: { cycleId: cycle.id, status: "FULFILLED" },
    }),
    2,
  );
  nodeAssert.equal(await db.cycle.count({ where: { active: true } }), 1);
  const nextCycle=await db.cycle.findFirstOrThrow({where:{active:true,documentTypeId:law}});
  nodeAssert.deepEqual((await db.obligation.findMany({where:{cycleId:nextCycle.id,kind:"REVIEW"},orderBy:{reviewIndex:"asc"}})).map(o=>[o.reviewIndex,o.dueDate]),[12,24,36].map((m,i)=>[i+2,addMonths(today,m,"ANNIVERSARY")]));
});
test("Unknown original emission cannot activate a law cycle", async () => {
  const o = await initial(law),
    form = new FormData();
  form.set("obligationId", o.id);
  form.append("files", await pdf());
  const s = await submitFiles(employee, form);
  await nodeAssert.rejects(
    () => reviewSubmission(rh, s.id, { approve: true, initialBackgroundConfirmed:true }),
    /emisión/,
  );
  nodeAssert.equal(await db.cycle.count(), 0);
});
test("Delivery pauses employee reminders; rejection resumes and approval satisfies only that obligation", async () => {
  const o = await initial(health, addDays(today, 5));
  const s = await upload(o.id);
  await prepareScheduledMessages(at(today));
  await processOutbox(at(today));
  nodeAssert.equal(
    await db.notification.count({ where: { kind: "COMPLIANCE" } }),
    0,
  );
  nodeAssert.equal(
    await db.notification.count({ where: { kind: "REVIEW_DIGEST" } }),
    1,
  );
  await nodeAssert.rejects(
    () => reviewSubmission(rh, s.id, { approve: false, reason: "" }),
    /motivo/,
  );
  await reviewSubmission(rh, s.id, {
    approve: false,
    reason: "Falta una página",
  });
  await prepareScheduledMessages(at(today));
  await processOutbox(at(today));
  nodeAssert.equal(
    await db.notification.count({
      where: { kind: "COMPLIANCE", status: "PREVIEW" },
    }),
    1,
  );
  const corrected = await upload(o.id);
  await reviewSubmission(rh, corrected.id, { approve: true });
  nodeAssert.equal(
    (await db.obligation.findUniqueOrThrow({ where: { id: o.id } })).status,
    "FULFILLED",
  );
  await nodeAssert.rejects(
    () => reviewSubmission(rh, corrected.id, { approve: true }),
    /pendiente/,
  );
});
test("One pending upload per obligation; filenames do not define allowed file content", async () => {
  const o = await initial();
  await upload(o.id);
  await nodeAssert.rejects(() => upload(o.id), /Ya existe/);
  const other = await initial(law),
    form = new FormData();
  form.set("obligationId", other.id);
  form.append(
    "files",
    new File(["not a PDF"], "fake.pdf", { type: "application/pdf" }),
  );
  await nodeAssert.rejects(
    () => submitFiles(employee, form),
    /Formato inválido/,
  );
});
test("Employee and supervisor cannot access another employee files or approve submissions", async () => {
  const o = await initial(),
    s = await upload(o.id);
  const file = await db.attachment.findFirstOrThrow({
    where: { submissionId: s.id },
  });
  nodeAssert.equal((await readAttachment(employee, file.id)).status, 200);
  await nodeAssert.rejects(() => readAttachment(foreign, file.id), /acceso/);
  await nodeAssert.rejects(() => readAttachment(supervisor, file.id), /acceso/);
  await nodeAssert.rejects(
    () => reviewSubmission(employee, s.id, { approve: true }),
    /Solo RH/,
  );
  await nodeAssert.rejects(() => upload(o.id, supervisor), /No puede/);
  await initial(health, addDays(today, 15), foreign);
  const own = await reportRows(employee, new URLSearchParams());
  nodeAssert.ok(own.every((r) => r.employeeId === employee.id));
  const team = await reportRows(supervisor, new URLSearchParams());
  nodeAssert.ok(team.every((r) => r.employeeId === employee.id));
  nodeAssert.equal("files" in team[0].submissions[0], false);
});
test("Reminders deduplicate, catch up only current stage and repeat weekly after expiry", async () => {
  await initial(health, addDays(today, 10));
  for (const delta of [0, 0, 5, 5, 10, 10, 17, 17, 31, 31]) {
    const now = at(addDays(today, delta));
    await prepareScheduledMessages(now);
    await processOutbox(now);
  }
  const notices = await db.notification.findMany({
    where: { kind: "COMPLIANCE" },
  });
  nodeAssert.equal(notices.length, 5);
  nodeAssert.ok(notices.every((m) => m.status === "PREVIEW"));
  nodeAssert.equal(
    await db.notification.count({ where: { kind: "SUPERVISOR" } }),
    5,
  );
});
test("Missed warning windows do not create accumulated notices", async () => {
  await initial(health, addDays(today, -16));
  await prepareScheduledMessages(at(today));
  await processOutbox(at(today));
  const events = await db.notificationEvent.findMany();
  nodeAssert.equal(events.filter((e) => e.status === "SENT").length, 1);
  nodeAssert.equal(events.filter((e) => e.status === "SKIPPED").length, 3);
  nodeAssert.ok(events.some((e) => e.stage.endsWith("W2")));
});
test("Reminder preparation obeys Puerto Rico delivery window", async () => {
  await initial(health, today);
  await prepareScheduledMessages(new Date(`${today}T10:00:00Z`));
  nodeAssert.equal(await db.notification.count(), 0);
  await prepareScheduledMessages(new Date(`${today}T22:00:00Z`));
  nodeAssert.equal(await db.notification.count(), 0);
});
test("Concurrent scheduler runs and restart retain completed jobs without duplicates", async () => {
  await initial(health, addDays(today, 5));
  await Promise.all([tick(at(today)), tick(at(today))]);
  await tick(at(today));
  nodeAssert.equal(
    await db.notification.count({ where: { kind: "COMPLIANCE" } }),
    1,
  );
  nodeAssert.ok(await db.setting.findUnique({ where: { key: "heartbeat" } }));
});
test("Queued messages recheck delivery state before first send", async () => {
  const o = await initial(health, today);
  await prepareScheduledMessages(at(today));
  const s = await upload(o.id);
  await processOutbox(at(today));
  nodeAssert.equal(
    (await db.notification.findFirstOrThrow({ where: { kind: "COMPLIANCE" } }))
      .status,
    "CANCELLED",
  );
  await reviewSubmission(rh, s.id, {
    approve: false,
    reason: "Documento ilegible",
  });
});
test("Ambiguous send beyond 24 hours is not automatically repeated", async () => {
  const m = await db.notification.create({
    data: {
      key: "ambiguous",
      kind: "DECISION",
      recipients: '["ana@example.test"]',
      subject: "Prueba",
      html: "",
      text: "",
      status: "SENDING",
      firstAttemptAt: new Date(at(today).getTime() - 25 * 3600000),
      leaseUntil: new Date(0),
    },
  });
  await deliverMessage(m.id, at(today));
  nodeAssert.equal(
    (await db.notification.findUniqueOrThrow({ where: { id: m.id } })).status,
    "UNCERTAIN",
  );
});
test("Versioned policies require explicit application and stale previews fail", async () => {
  const o = await initial(health),
    s = await upload(o.id);
  await reviewSubmission(rh, s.id, { approve: true });
  const old = await db.obligation.findFirstOrThrow({
    where: { employeeId: employee.id, kind: "RENEWAL" },
  });
  await saveDocument(
    rh,
    { ...ruleBody(), expiryMode: "FROM_ISSUE", validityMonths: 24 },
    health,
  );
  nodeAssert.equal(
    (await db.obligation.findUniqueOrThrow({ where: { id: old.id } })).dueDate,
    old.dueDate,
  );
  const preview = await ruleApplicationPreview(health);
  nodeAssert.equal(preview.changes.length, 1);
  await db.obligation.update({
    where: { id: old.id },
    data: { revision: { increment: 1 } },
  });
  await nodeAssert.rejects(
    () => applyCurrentRule(rh, health, preview.digest),
    /cambiaron/,
  );
  const current = await ruleApplicationPreview(health);
  await applyCurrentRule(rh, health, current.digest);
  const newObligation = await db.obligation.findFirstOrThrow({
    where: { employeeId: employee.id, kind: "RENEWAL", status: "OPEN" },
  });
  nodeAssert.equal(newObligation.dueDate, addMonths(s.issueDate!, 24));
  nodeAssert.equal(
    await db.submission.count({ where: { status: "APPROVED" } }),
    1,
  );
});
test("Disabled employee loses access; reactivation creates fresh requirements without erasing history", async () => {
  await initial();
  await saveEmployee(rh, { ...employee, active: false }, employee.id);
  nodeAssert.equal(await db.obligation.count({ where: { status: "OPEN" } }), 0);
  await saveEmployee(rh, { ...employee, active: true }, employee.id);
  nodeAssert.equal(await db.obligation.count({ where: { status: "OPEN" } }), 1);
  nodeAssert.equal(
    await db.obligation.count({ where: { status: "CANCELLED" } }),
    1,
  );
});
test("OTP requires matching employee identity, consumes once and counts wrong attempts", async () => {
  const req = new NextRequest("http://localhost:3000/api/auth/request", {
    headers: { host: "localhost:3000" },
  });
  const challenge = await requestCode(req, {
      cpid: "CPID E1",
      lastNames: "lopez",
    }),
    mail = await db.notification.findFirstOrThrow({ where: { kind: "AUTH" } }),
    code = /\b\d{6}\b/.exec(mail.text)![0];
  await nodeAssert.rejects(
    () =>
      verifyCode({
        challengeId: challenge.challengeId,
        code: code === "000000" ? "111111" : "000000",
      }),
    /Código inválido/,
  );
  nodeAssert.equal(
    (
      await db.challenge.findUniqueOrThrow({
        where: { id: challenge.challengeId },
      })
    ).attempts,
    1,
  );
  nodeAssert.equal(
    (await verifyCode({ challengeId: challenge.challengeId, code })).status,
    200,
  );
  await nodeAssert.rejects(
    () => verifyCode({ challengeId: challenge.challengeId, code }),
    /Código inválido/,
  );
  nodeAssert.equal(await db.session.count(), 1);
  await nodeAssert.rejects(
    () => requestCode(req, { cpid: "E1", lastNames: "López" }),
    /Espere/,
  );
});
test("Unknown identity receives no code and mailbox is unavailable on remote hosts", async () => {
  const req = new NextRequest("http://localhost:3000/api/auth/request", {
    headers: { host: "localhost:3000" },
  });
  await requestCode(req, { cpid: "E1", lastNames: "Otro apellido" });
  nodeAssert.equal(await db.notification.count(), 0);
  nodeAssert.throws(
    () =>
      localhostOnly(
        new NextRequest("https://rh.example.test/api/dev/mailbox", {
          headers: { host: "rh.example.test" },
        }),
      ),
    /localhost/,
  );
});
test("Report XLSX and PDF exports agree with filtered visibility", async () => {
  await initial(health, today);
  await initial(health, today, foreign);
  const rows = await reportRows(
    employee,
    new URLSearchParams("state=VENCE_HOY"),
  );
  nodeAssert.equal(rows.length, 1);
  const excel = await exportReport(
      employee,
      new URLSearchParams("state=VENCE_HOY&format=xlsx"),
    ),
    workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await excel.arrayBuffer()) as never);
  nodeAssert.equal(workbook.worksheets[0].rowCount, 9);
  nodeAssert.equal(workbook.worksheets[0].getCell("A9").value, employee.cpid);
  const pdf = await exportReport(employee, new URLSearchParams("format=pdf"));
  nodeAssert.equal(
    (await PDFDocument.load(await pdf.arrayBuffer())).getPageCount(),
    1,
  );
});
test("PostgreSQL consistent backup includes immutable attachments", async () => {
  await upload((await initial()).id);
  const backup = await createBackup();
  const snapshot = JSON.parse(await fs.readFile(path.join(backup.path,"database.json"),"utf8"));
  nodeAssert.equal(snapshot.format,"UPKEEPHR-PG-1");
  const file=snapshot.tables.attachment[0];
  nodeAssert.ok((await fs.stat(path.join(backup.path,"files",file.storageKey))).size>0);
  nodeAssert.equal(snapshot.tables.employee.length,4);
});
async function importFile() {
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet("Actualizado");
  sheet.addRow([
    "CPID",
    "Nombre",
    "Email",
    "Site",
    "Posición",
    "Fecha Ingreso",
    "LEY 300 Fecha Emisión",
    "LEY 300 Fecha Venci.",
    "Rev. 2 Ant. Penales Fecha Entregado",
    "Cert / Salud Fecha Venci.",
  ]);
  sheet.addRow([
    "NEW1",
    "Rivera, Rosa",
    "rosa@example.test",
    "LOÍZA",
    "Maestra",
    new Date("2021-01-01T12:00:00Z"),
    { formula: "EDATE(H2,-60)", result: new Date("2021-01-01T12:00:00Z") },
    new Date("2026-01-01T12:00:00Z"),
    new Date("2022-01-02T12:00:00Z"),
    new Date("2027-01-01T12:00:00Z"),
  ]);
  sheet.addRow([
    "",
    "Persona sin apellidos",
    "no-email",
    "CAGUAS",
    "Maestra",
    new Date("2021-01-01T12:00:00Z"),
  ]);
  const buffer = await wb.xlsx.writeBuffer();
  return new File([new Uint8Array(buffer as ArrayBuffer)], "migracion.xlsx");
}
test("Import previews quarantine identities, preserve formula provenance, and do not overwrite later approvals", async () => {
  await db.documentType.updateMany({
    where: { code: { in: ["SALUD", "LEY300"] } },
    data: { autoAssign: true },
  });
  const file = await importFile(),
    batch = await previewImport(rh, file);
  nodeAssert.equal(batch.rows.length, 2);
  nodeAssert.equal(batch.rows[1].issues.length, 3);
  nodeAssert.ok(batch.rows[0].payload.warnings.length > 0);
  const result = await commitImport(rh, batch.id);
  nodeAssert.equal(result.imported, 1);
  nodeAssert.equal(result.blocked, 1);
  const imported = await db.employee.findUniqueOrThrow({
    where: { cpid: "NEW1" },
  });
  nodeAssert.equal(
    await db.cycle.count({
      where: { employeeId: imported.id, documentTypeId: law },
    }),
    0,
  );
  await verifyImportedLaw(rh, imported.id, "2021-01-01", true);
  const pendingInitial=await db.obligation.findFirstOrThrow({where:{employeeId:imported.id,documentTypeId:law,kind:"INITIAL"}});
  nodeAssert.equal(pendingInitial.status,"OPEN","Verifying emission must not invent a missing initial bundle");
  nodeAssert.equal(
    await db.submission.count({
      where: { employeeId: imported.id, origin: "LEGACY_NO_FILE" },
    }),
    1,
  );
  const repeat = await previewImport(rh, file);
  nodeAssert.equal(repeat.id, batch.id);
  await commitImport(rh, batch.id);
  nodeAssert.equal(await db.employee.count({ where: { cpid: "NEW1" } }), 1);
  await fixImportRow(rh, batch.rows[1].id, {
    ...batch.rows[1].payload,
    cpid: "NEW2",
    lastNames: "Demo",
    email: "new2@example.test",
  });
  const fixed = await commitImport(rh, batch.id);
  nodeAssert.equal(fixed.imported, 1);
  nodeAssert.equal(
    await db.submission.count({
      where: { employeeId: imported.id, origin: "LEGACY_NO_FILE" },
    }),
    1,
  );
  const oldCycle=await db.cycle.findFirstOrThrow({where:{employeeId:imported.id,documentTypeId:law,active:true}});
  const initialBundle=await upload(pendingInitial.id,imported,oldCycle.issueDate!,oldCycle.expiresDate!);
  await reviewSubmission(rh,initialBundle.id,{approve:true,initialBackgroundConfirmed:true});
  nodeAssert.equal(await db.cycle.count({where:{employeeId:imported.id,documentTypeId:law}}),1,"The missing initial bundle completes the already verified cycle");
  nodeAssert.equal((await db.cycle.findUniqueOrThrow({where:{id:oldCycle.id}})).expiresDate,oldCycle.expiresDate);
  const current=await (await import("../src/lib/dashboard")).currentRequirements(rh,new URLSearchParams({employee:imported.id,document:law}));
  nodeAssert.equal(current[0].law!.periods[0].state,"APROBADA");nodeAssert.equal(current[0].law!.periods[0].deliveredDate,today);
});
test(
  "Provided reference workbook parses all employees without changing the source",
  { skip: !process.env.RH_SOURCE_XLSX },
  async () => {
    const source = process.env.RH_SOURCE_XLSX!,
      before = await fs.readFile(source),
      batch = await previewImport(
        rh,
        new File([new Uint8Array(before)], "referencia.xlsx"),
      );
    nodeAssert.equal(batch.rows.length, 393);
    nodeAssert.equal(batch.rows.filter((r) => !r.payload.cpid).length, 13);
    nodeAssert.ok(
      batch.rows.every((r) => r.payload.documents.LEY300.issueDerived),
    );
    nodeAssert.deepEqual(await fs.readFile(source), before);
  },
);

test("Delayed scheduled mail stays inside the operating window, terminal failures do not block the queue", async () => {
  await initial(health, today);
  await prepareScheduledMessages(at(today));
  await processOutbox(new Date(`${today}T23:00:00Z`));
  nodeAssert.equal(
    await db.notification.count({
      where: { kind: "COMPLIANCE", status: "PREVIEW" },
    }),
    0,
  );
  await db.notification.createMany({
    data: Array.from({ length: 101 }, (_, i) => ({
      key: `terminal:${i}`,
      kind: "DECISION",
      subject: "Error terminal",
      html: "",
      text: "",
      recipients: "[]",
      status: "FAILED",
      attempts: 5,
      nextAttemptAt: new Date(0),
      createdAt: new Date(0),
    })),
  });
  await processOutbox(at(today));
  nodeAssert.equal(
    await db.notification.count({
      where: { kind: "COMPLIANCE", status: "PREVIEW" },
    }),
    1,
  );
});
test("Early, duplicate and out-of-order provider webhooks retain delivery and bounce results", async () => {
  await recordProviderEvent("evt1", "provider-1", "DELIVERED");
  await recordProviderEvent("evt1", "provider-1", "DELIVERED");
  nodeAssert.equal(await db.webhookEvent.count(), 1);
  const m = await db.notification.create({
    data: {
      key: "provider-message",
      kind: "DECISION",
      subject: "Resultado",
      html: "",
      text: "",
      recipients: "[]",
      providerId: "provider-1",
      status: "SENDING",
    },
  });
  await db.$transaction((tx) => reconcileProviderEvents(tx, "provider-1"));
  nodeAssert.equal(
    (await db.notification.findUniqueOrThrow({ where: { id: m.id } })).status,
    "DELIVERED",
  );
  await recordProviderEvent("evt2", "provider-1", "BOUNCED");
  await recordProviderEvent("evt3", "provider-1", "DELIVERED");
  nodeAssert.equal(
    (await db.notification.findUniqueOrThrow({ where: { id: m.id } })).status,
    "BOUNCED",
  );
  nodeAssert.equal(
    await db.setting.count({
      where: { key: { startsWith: "provider-event:" } },
    }),
    0,
  );
});
test("Explicit rule preview includes new reviews for an already fulfilled document without an expiry", async () => {
  await saveDocument(
    rh,
    { ...ruleBody(), expiryMode: "NONE", validityMonths: null },
    health,
  );
  await reviewSubmission(rh, (await upload((await initial()).id)).id, {
    approve: true,
  });
  await saveDocument(
    rh,
    {
      ...ruleBody(),
      expiryMode: "NONE",
      validityMonths: null,
      reviewMonths: 12,
      reviewCount: 2,
      reviewTargetId: health,
    },
    health,
  );
  const preview = await ruleApplicationPreview(health);
  nodeAssert.equal(preview.changes.length, 2);
  await applyCurrentRule(rh, health, preview.digest);
  nodeAssert.equal(
    await db.obligation.count({ where: { kind: "REVIEW", status: "OPEN" } }),
    2,
  );
});
test("Server rejects oversized and excess files and locks access after five wrong OTP attempts", async () => {
  const o = await initial(),
    f = new FormData();
  f.set("obligationId", o.id);
  for (let i = 0; i < 6; i++) f.append("files", await pdf());
  await nodeAssert.rejects(() => submitFiles(employee, f), /cinco/);
  const large = new Uint8Array(10 * 1024 * 1024 + 1);
  large.set(Buffer.from("%PDF-"));
  const g = new FormData();
  g.set("obligationId", o.id);
  g.append(
    "files",
    new File([large], "too-big.pdf", { type: "application/pdf" }),
  );
  await nodeAssert.rejects(() => submitFiles(employee, g), /10 MB/);
  const c = await requestCode(
    new NextRequest("http://localhost:3000/api/auth/request"),
    { cpid: "E1", lastNames: "López" },
  );
  const m = await db.notification.findFirstOrThrow({ where: { kind: "AUTH" } }),
    correct = /\b\d{6}\b/.exec(m.text)![0],
    wrong = correct === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    await nodeAssert.rejects(
      () => verifyCode({ challengeId: c.challengeId, code: wrong }),
      /Código inválido/,
    );
  await nodeAssert.rejects(
    () => verifyCode({ challengeId: c.challengeId, code: correct }),
    /Código inválido/,
  );
  nodeAssert.equal(await db.session.count(), 0);
});

test("Scope changes are previewed before canceling an existing requirement and reactivation keeps its history", async () => {
  const original = await initial();
  await saveDocument(rh, { ...ruleBody(), sites: ["LOIZA"] }, health);
  const preview = await ruleApplicationPreview(health);
  nodeAssert.equal(preview.changes[0].newDate, "");
  nodeAssert.equal(
    (await db.obligation.findUniqueOrThrow({ where: { id: original.id } }))
      .status,
    "OPEN",
  );
  await applyCurrentRule(rh, health, preview.digest);
  nodeAssert.equal(
    (await db.obligation.findUniqueOrThrow({ where: { id: original.id } }))
      .status,
    "CANCELLED",
  );
  await saveDocument(
    rh,
    { ...ruleBody(), sites: ["CAGUAS"], autoAssign: true },
    health,
  );
  nodeAssert.equal(
    await db.obligation.count({
      where: { employeeId: employee.id, status: "OPEN" },
    }),
    1,
  );
  nodeAssert.equal(
    await db.obligation.count({
      where: { employeeId: employee.id, status: "CANCELLED" },
    }),
    1,
  );
});

test("Restart drops old unsent digests and sends only the current warning stage", async () => {
  await initial(health, addDays(today, 10));
  await prepareScheduledMessages(at(today));
  const old = await db.notification.findFirstOrThrow({
    where: { kind: "COMPLIANCE" },
  });
  const later = at(addDays(today, 6));
  await prepareScheduledMessages(later);
  await processOutbox(later);
  nodeAssert.equal(
    (await db.notification.findUniqueOrThrow({ where: { id: old.id } })).status,
    "CANCELLED",
  );
  nodeAssert.equal(
    await db.notification.count({
      where: { kind: "COMPLIANCE", status: "PREVIEW" },
    }),
    1,
  );
  nodeAssert.equal(
    await db.notificationEvent.count({
      where: { status: "SENT", stage: { endsWith: "D5" } },
    }),
    1,
  );
});
