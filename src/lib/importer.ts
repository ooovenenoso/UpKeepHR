import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import {
  assert,
  normalize,
  normalizeCpid,
  localDate,
  validDate,
} from "./domain";
import { assignApplicable, audit, isRh, generateCycle } from "./compliance";
import type { Employee } from "../generated/prisma/client";

export type ImportedDocument = {
  issueDate: string | null;
  expiresDate: string | null;
  issueDerived: boolean;
  notApplicable: boolean;
};
export type ImportPayload = {
  cpid: string;
  name: string;
  lastNames: string;
  email: string;
  site: string;
  position: string;
  hireDate: string;
  documents: Record<string, ImportedDocument>;
  revisions: (string | null)[];
  warnings: string[];
};
const columns: Record<string, string> = {
  cpid: "CPID",
  name: "Nombre",
  email: "Email",
  site: "Site",
  position: "Posición",
  hireDate: "Fecha Ingreso",
};
const docHeaders: Record<string, [string, string]> = {
  SALUD: ["Cert / Salud Fecha Emisión", "Cert / Salud Fecha Venci."],
  LEY300: ["LEY 300 Fecha Emisión", "LEY 300 Fecha Venci."],
  FAMILIA: ["Dept. Fam Fecha Emisión", "Dept. Fam Fecha Venci."],
  CPR: ["CPR Fecha Emisión", "CPR Fecha Venci."],
  HUELLAS: ["Huellas Fecha Emisión", "Huellas Fecha Venci."],
  INOCUIDAD: ["Inocuidad Fecha Emisión", "Inocuidad Fecha Venci."],
};
export function excelDate(
  value: ExcelJS.CellValue,
  date1904 = false,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object" && "formula" in value)
    return excelDate(value.result ?? null, date1904);
  if (typeof value === "object" && "sharedFormula" in value)
    return excelDate(value.result ?? null, date1904);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const result = new Date(
      Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) +
        Math.floor(value) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    return validDate(result) ? result : null;
  }
  if (typeof value === "string") {
    if (validDate(value.trim())) return value.trim();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
    if (m) {
      const date = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      return validDate(date) ? date : null;
    }
  }
  return null;
}
function textCell(cell: ExcelJS.Cell) {
  const v = cell.value;
  if (v === null) return "";
  if (typeof v === "object" && !(v instanceof Date) && "richText" in v)
    return v.richText.map((r) => r.text).join("");
  return String(cell.text ?? "").trim();
}
export function identityIssues(p: ImportPayload) {
  const issues = [];
  if (!p.cpid) issues.push("CPID vacío");
  if (!p.name || !p.lastNames) issues.push("Apellidos sin identificar");
  if (!z.email().safeParse(p.email).success) issues.push("Correo inválido");
  if (!p.site) issues.push("Sede vacía");
  if (!p.position) issues.push("Puesto vacío");
  if (!validDate(p.hireDate)) issues.push("Ingreso inválido");
  return issues;
}
export async function previewImport(
  actor: Employee,
  file: File,
  mapping: Record<string, string> = {},
) {
  assert(isRh(actor), "Solo RH puede importar.", 403);
  assert(
    file.size > 0 && file.size <= 25 * 1024 * 1024,
    "Use un Excel de hasta 25 MB.",
  );
  const bytes = Buffer.from(await file.arrayBuffer()),
    hash = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.importBatch.findUnique({ where: { hash } });
  if (existing) return getImport(existing.id);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  const sheet = workbook.getWorksheet("Actualizado") ?? workbook.worksheets[0];
  assert(sheet, "El archivo no tiene hojas.");
  let headerRow = 0,
    headers: Record<string, number> = {};
  for (let i = 1; i <= Math.min(sheet.rowCount, 20); i++) {
    const candidate: Record<string, number> = {};
    sheet.getRow(i).eachCell((c, n) => {
      candidate[normalize(textCell(c))] = n;
    });
    if (
      candidate[normalize(mapping.name ?? "Nombre")] &&
      candidate[normalize(mapping.cpid ?? "CPID")]
    ) {
      headerRow = i;
      headers = candidate;
      break;
    }
  }
  assert(
    headerRow,
    "No se encontró una fila con Nombre y CPID. Puede indicar sus encabezados en el mapeo.",
  );
  const rows: {
    rowNumber: number;
    payload: ImportPayload;
    issues: string[];
  }[] = [];
  assert(
    sheet.rowCount < 20000,
    "El archivo supera el máximo de 20.000 filas.",
  );
  for (let n = headerRow + 1; n <= sheet.rowCount; n++) {
    const row = sheet.getRow(n),
      get = (key: string, defaultHeader: string) =>
        row.getCell(headers[normalize(mapping[key] ?? defaultHeader)] ?? 16384);
    const name = textCell(get("name", columns.name));
    if (!name) continue;
    const p: ImportPayload = {
      cpid: normalizeCpid(textCell(get("cpid", columns.cpid))),
      name,
      lastNames: name.includes(",") ? name.split(",")[0].trim() : "",
      email: textCell(get("email", columns.email)),
      site: textCell(get("site", columns.site)),
      position: textCell(get("position", columns.position)),
      hireDate:
        excelDate(
          get("hireDate", columns.hireDate).value,
          workbook.properties.date1904,
        ) ?? "",
      documents: {},
      revisions: [],
      warnings: [],
    };
    for (const [code, [emission, expiration]] of Object.entries(docHeaders)) {
      const issue = get(`${code}_issue`, emission),
        expires = get(`${code}_expiry`, expiration);
      const derived = !!(
        issue.value &&
        typeof issue.value === "object" &&
        ("formula" in issue.value || "sharedFormula" in issue.value)
      );
      const notApplicable = ["n/a", "no aplica", "na"].includes(
        normalize(textCell(expires)),
      );
      p.documents[code] = {
        issueDate: excelDate(issue.value, workbook.properties.date1904),
        expiresDate: excelDate(expires.value, workbook.properties.date1904),
        issueDerived: derived,
        notApplicable,
      };
      if (derived)
        p.warnings.push(
          `${code}: emisión calculada; requiere certificado para verificarla.`,
        );
      if (textCell(expires) && !notApplicable && !p.documents[code].expiresDate)
        p.warnings.push(`${code}: vencimiento ilegible; queda pendiente.`);
    }
    for (let i = 1; i <= 5; i++)
      p.revisions.push(
        excelDate(
          get(`revision${i}`, `Rev. ${i} Ant. Penales Fecha Entregado`).value,
          workbook.properties.date1904,
        ),
      );
    rows.push({ rowNumber: n, payload: p, issues: identityIssues(p) });
  }
  assert(rows.length, "No se encontraron empleados.");
  const counts = new Map<string, number>();
  for (const r of rows)
    if (r.payload.cpid)
      counts.set(r.payload.cpid, (counts.get(r.payload.cpid) ?? 0) + 1);
  for (const r of rows)
    if ((counts.get(r.payload.cpid) ?? 0) > 1)
      r.issues.push("CPID repetido en el archivo");
  const batch = await db.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        filename: file.name,
        hash,
        rows: {
          create: rows.map((r) => ({
            rowNumber: r.rowNumber,
            payload: JSON.stringify(r.payload),
            issues: JSON.stringify(r.issues),
          })),
        },
      },
    });
    await audit(tx, actor.id, "IMPORT_PREVIEW", batch.id, {
      filename: file.name,
      rows: rows.length,
    });
    return batch;
  });
  return getImport(batch.id);
}
export async function getImport(id: string) {
  const batch = await db.importBatch.findUniqueOrThrow({
    where: { id },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  return {
    ...batch,
    rows: batch.rows.map((r) => ({
      ...r,
      payload: JSON.parse(r.payload) as ImportPayload,
      issues: JSON.parse(r.issues) as string[],
    })),
  };
}
export async function fixImportRow(
  actor: Employee,
  id: string,
  input: unknown,
) {
  assert(isRh(actor), "Solo RH puede corregir importaciones.", 403);
  const changes = z
    .object({
      cpid: z.string().max(64),
      lastNames: z.string().max(100),
      email: z.string().max(200),
      site: z.string().max(80),
      position: z.string().max(100),
      hireDate: z.string().max(10),
    })
    .parse(input);
  const row = await db.importRow.findUniqueOrThrow({ where: { id } });
  assert(row.status !== "IMPORTED", "El registro ya fue importado.");
  const payload = {
    ...JSON.parse(row.payload),
    ...changes,
    cpid: normalizeCpid(changes.cpid),
  } as ImportPayload;
  await db.importRow.update({
    where: { id },
    data: {
      payload: JSON.stringify(payload),
      issues: JSON.stringify(identityIssues(payload)),
    },
  });
  return getImport(row.batchId);
}
export async function commitImport(actor: Employee, id: string) {
  assert(isRh(actor), "Solo RH puede importar.", 403);
  const batch = await getImport(id);
  let imported = 0,
    skipped = 0,
    blocked = 0;
  const counts = new Map<string, number>();
  for (const r of batch.rows)
    if (r.payload.cpid)
      counts.set(r.payload.cpid, (counts.get(r.payload.cpid) ?? 0) + 1);
  for (const row of batch.rows) {
    if (row.status === "IMPORTED") {
      skipped++;
      continue;
    }
    const p = row.payload,
      issues = identityIssues(p);
    if ((counts.get(p.cpid) ?? 0) > 1)
      issues.push("CPID repetido en el archivo");
    const existing = await db.employee.findUnique({ where: { cpid: p.cpid } });
    if (existing && normalize(existing.name) !== normalize(p.name))
      issues.push("CPID ya pertenece a otro expediente");
    if (issues.length) {
      blocked++;
      await db.importRow.update({
        where: { id: row.id },
        data: { issues: JSON.stringify(issues) },
      });
      continue;
    }
    await db.$transaction(async (tx) => {
      if (existing) {
        await tx.importRow.update({
          where: { id: row.id },
          data: { status: "IMPORTED", employeeId: existing.id, issues: "[]" },
        });
        skipped++;
        return;
      }
      const employee = await tx.employee.create({
        data: {
          cpid: p.cpid,
          name: p.name,
          lastNames: p.lastNames,
          email: p.email,
          site: p.site,
          position: p.position,
          hireDate: p.hireDate,
          source: "IMPORT",
          legacyData: JSON.stringify(p),
        },
      });
      await assignApplicable(tx, employee);
      for (const [code, document] of Object.entries(p.documents)) {
        const type = await tx.documentType.findUnique({ where: { code } });
        if (!type) continue;
        const assignment = await tx.assignment.findUnique({
          where: {
            employeeId_documentTypeId: {
              employeeId: employee.id,
              documentTypeId: type.id,
            },
          },
        });
        if (!assignment) continue;
        if (document.notApplicable) {
          await tx.assignment.update({
            where: { id: assignment.id },
            data: { active: false },
          });
          await tx.obligation.updateMany({
            where: { assignmentId: assignment.id },
            data: { status: "CANCELLED" },
          });
          continue;
        }
        if (code === "LEY300" || !document.expiresDate) continue;
        const rule = await tx.rule.findUniqueOrThrow({
          where: { id: assignment.ruleId },
        });
        const cycle = await tx.cycle.create({
          data: {
            employeeId: employee.id,
            documentTypeId: type.id,
            ruleId: rule.id,
            issueDate: document.issueDerived ? null : document.issueDate,
            expiresDate: document.expiresDate,
            origin: "IMPORT",
          },
        });
        await tx.obligation.updateMany({
          where: {
            assignmentId: assignment.id,
            kind: "INITIAL",
            status: "OPEN",
          },
          data: { status: "FULFILLED", fulfilledDate: null },
        });
        await generateCycle(tx, cycle, rule);
      }
      await tx.importRow.update({
        where: { id: row.id },
        data: { status: "IMPORTED", employeeId: employee.id, issues: "[]" },
      });
      await audit(tx, actor.id, "EMPLOYEE_IMPORTED", employee.id, {
        batchId: id,
        rowNumber: row.rowNumber,
        original: p,
      });
      imported++;
    },{maxWait:20000,timeout:30000});
  }
  await db.importBatch.update({
    where: { id },
    data: { status: blocked ? "PARTIAL" : "IMPORTED" },
  });
  await db.audit.create({
    data: {
      actorId: actor.id,
      action: "IMPORT_COMMITTED",
      entityId: id,
      detail: JSON.stringify({ imported, skipped, blocked }),
    },
  });
  return { imported, skipped, blocked, batch: await getImport(id) };
}
export async function verifyImportedLaw(
  actor: Employee,
  employeeId: string,
  issueDate: string,
  confirmLegacy: boolean,
) {
  assert(isRh(actor), "Solo RH puede verificar la emisión.", 403);
  assert(
    validDate(issueDate) && issueDate <= localDate(),
    "Emisión original inválida o futura.",
  );
  return db.$transaction(async (tx) => {
    const employee = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
    });
    assert(
      employee.active && employee.source === "IMPORT",
      "Use esta acción únicamente para expedientes importados activos.",
    );
    assert(
      !(await tx.cycle.count({
        where: {
          employeeId,
          documentType: { code: "LEY300" },
          active: true,
          verified: true,
        },
      })),
      "Ya existe un ciclo confirmado. Registre la renovación mediante una entrega.",
    );
    const type = await tx.documentType.findUniqueOrThrow({
        where: { code: "LEY300" },
        include: { rules: { orderBy: { version: "desc" }, take: 1 } },
      }),
      rule = type.rules[0];
    const assignment = await tx.assignment.findUniqueOrThrow({
      where: {
        employeeId_documentTypeId: { employeeId, documentTypeId: type.id },
      },
    });
    const cycle = await tx.cycle.create({
      data: {
        employeeId,
        documentTypeId: type.id,
        ruleId: rule.id,
        issueDate,
        expiresDate: (await import("./domain")).expiryDate(
          rule,
          issueDate,
          employee.legacyData
            ? JSON.parse(employee.legacyData).documents.LEY300.expiresDate
            : null,
        ),
        verified: true,
        origin: "VERIFIED_IMPORT",
      },
    });
    const payload = employee.legacyData
      ? (JSON.parse(employee.legacyData) as ImportPayload)
      : null;
    const base = await tx.obligation.findFirst({
      where: { assignmentId: assignment.id, kind: "INITIAL", status: "OPEN" },
    });
    const initialDelivered = confirmLegacy
      ? (payload?.revisions[0] ?? null)
      : null;
    if(initialDelivered)await tx.obligation.updateMany({
      where: { assignmentId: assignment.id, kind: "INITIAL", status: "OPEN" },
      data: { status: "FULFILLED", fulfilledDate: initialDelivered },
    });
    if (base && initialDelivered)
      await tx.submission.create({
        data: {
          employeeId,
          obligationId: base.id,
          status: "APPROVED",
          receivedDate: initialDelivered,
          issueDate,
          expiresDate: cycle.expiresDate,
          reviewedAt: new Date(),
          reviewerId: actor.id,
          origin: "LEGACY_NO_FILE",
          reason:
            "Entrega inicial antigua del documento base confirmada por RH; sin archivo adjunto.",
        },
      });
    await generateCycle(tx, cycle, rule);
    if (confirmLegacy && payload) {
      for (let index = 2; index <= (rule.reviewCount??4); index++) {
        const delivered = payload.revisions[index-1];
        if (!delivered) continue;
        const o = await tx.obligation.findFirst({
          where: { cycleId: cycle.id, kind: "REVIEW", reviewIndex: index },
        });
        if (!o) continue;
        await tx.obligation.update({
          where: { id: o.id },
          data: { status: "FULFILLED", fulfilledDate: delivered },
        });
        await tx.submission.create({
          data: {
            employeeId,
            obligationId: o.id,
            status: "APPROVED",
            receivedDate: delivered,
            reviewedAt: new Date(),
            reviewerId: actor.id,
            origin: "LEGACY_NO_FILE",
            reason:
              "Entrega histórica confirmada por RH; archivo no disponible en la hoja.",
          },
        });
      }
    }
    await audit(tx, actor.id, "LAW_ISSUE_VERIFIED", cycle.id, {
      employeeId,
      issueDate,
      confirmLegacy,
      initialLegacyDelivery: payload?.revisions[0] ?? null,
    });
    return cycle;
  });
}
