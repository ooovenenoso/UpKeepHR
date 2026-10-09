import { db, type Tx } from "./db";
import { databaseSchema } from "./config";
import {
  assert,
  addDays,
  addMonths,
  expiryDate,
  localDate,
  validDate,
  normalizeCpid,
} from "./domain";
import { documentInput, employeeInput, type DocumentInput } from "./schemas";
import type {
  Rule,
  Cycle,
  Employee,
  Obligation,
} from "../generated/prisma/client";
import { createHash, randomUUID } from "node:crypto";

export const isRh = (employee: Pick<Employee, "role">) =>
  ["RH", "SUPERADMIN"].includes(employee.role);
export const visibility = (viewer: Employee) =>
  isRh(viewer)
    ? {}
    : viewer.role === "SUPERVISOR"
      ? { OR: [{ id: viewer.id }, { supervisorId: viewer.id }] }
      : { id: viewer.id };
export async function audit(
  tx: Tx,
  actorId: string | null,
  action: string,
  entityId: string,
  detail: unknown,
) {
  await tx.audit.create({
    data: { actorId, action, entityId, detail: JSON.stringify(detail) },
  });
}
export function applies(rule: Rule, employee: Employee) {
  const sites = JSON.parse(rule.sites) as string[],
    positions = JSON.parse(rule.positions) as string[];
  return (
    (!sites.length || sites.includes(employee.site)) &&
    (!positions.length || positions.includes(employee.position))
  );
}
function ruleData(input: DocumentInput) {
  return {
    ...input,
    reminders: JSON.stringify(input.reminders),
    sites: JSON.stringify(input.sites),
    positions: JSON.stringify(input.positions),
  };
}
export async function assign(
  tx: Tx,
  employee: Employee,
  documentTypeId: string,
  dueDate?: string,
) {
  const type = await tx.documentType.findUniqueOrThrow({
    where: { id: documentTypeId },
    include: { rules: { orderBy: { version: "desc" }, take: 1 } },
  });
  assert(type.active, "Este documento está desactivado.");
  const rule = type.rules[0];
  assert(rule, "El documento no tiene reglas.");
  const existing = await tx.assignment.findUnique({
    where: {
      employeeId_documentTypeId: { employeeId: employee.id, documentTypeId },
    },
  });
  if (existing?.active) return existing;
  const today = localDate();
  const assignment = existing
    ? await tx.assignment.update({
        where: { id: existing.id },
        data: { active: true, ruleId: rule.id, assignedDate: today },
      })
    : await tx.assignment.create({
        data: {
          employeeId: employee.id,
          documentTypeId,
          ruleId: rule.id,
          assignedDate: today,
        },
      });
  const base = employee.hireDate > today ? employee.hireDate : today;
  await tx.obligation.create({
    data: {
      key: existing
        ? `${assignment.id}:reassigned:${randomUUID()}`
        : `${assignment.id}:initial`,
      employeeId: employee.id,
      documentTypeId,
      assignmentId: assignment.id,
      ruleId: rule.id,
      kind: "INITIAL",
      dueDate: dueDate ?? addDays(base, rule.initialDays),
    },
  });
  return assignment;
}
export async function assignApplicable(tx: Tx, employee: Employee) {
  const types = await tx.documentType.findMany({
    where: { active: true, autoAssign: true },
    include: { rules: { orderBy: { version: "desc" }, take: 1 } },
  });
  for (const t of types)
    if (t.rules[0] && applies(t.rules[0], employee))
      await assign(tx, employee, t.id);
}
export async function saveEmployee(
  actor: Employee,
  input: unknown,
  id?: string,
) {
  assert(isRh(actor), "Solo RH puede administrar empleados.", 403);
  const data = employeeInput.parse(input);
  assert(actor.role === "SUPERADMIN" || data.role !== "RH", "Solo superadmin puede dar acceso RH.", 403);
  assert(data.cpid.length > 0, "CPID obligatorio.");
  if (data.supervisorId) {
    const supervisor = await db.employee.findUnique({
      where: { id: data.supervisorId },
    });
    assert(
      supervisor?.active &&
        ["SUPERVISOR", "RH"].includes(supervisor.role) &&
        supervisor.id !== id,
      "Supervisora inválida.",
    );
  }
  if (id === actor.id)
    assert(
      data.active && data.role === "RH",
      "No puede quitarse su propio acceso RH.",
    );
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7364031)`;
    const previous = id
      ? await tx.employee.findUniqueOrThrow({ where: { id } })
      : null;
    if (previous?.role === "RH") assert(actor.role === "SUPERADMIN", "Solo superadmin administra personal con acceso RH.", 403);
    const privilegedAccount=id?await tx.platformUser.findUnique({where:{employeeId:id}}):null;
    if(privilegedAccount && ["RH","SUPERADMIN"].includes(privilegedAccount.role)) {
      assert(actor.role==="SUPERADMIN","Solo superadmin administra expedientes vinculados a cuentas RH o superadmin.",403);
      if(!data.active&&privilegedAccount.role==="SUPERADMIN")assert((await tx.platformUser.count({where:{role:"SUPERADMIN",active:true}}))>1&&privilegedAccount.id!==(actor as Employee&{accountId?:string}).accountId,"Debe conservar su acceso y al menos un superadmin activo.");
    }
    const employee = id
      ? await tx.employee.update({ where: { id }, data })
      : await tx.employee.create({ data });
    const account=await tx.platformUser.findUnique({where:{employeeId:employee.id}});
    if(account && !["RH","SUPERADMIN"].includes(account.role)) {
      await tx.platformUser.update({where:{id:account.id},data:{name:employee.name,email:employee.email.toLowerCase(),role:employee.role,...(!data.active?{active:false}:{})}});
      if(previous && (previous.role!==data.role||previous.email!==data.email||!data.active))await tx.authSession.deleteMany({where:{userId:account.id}});
    }
    if (!data.active) {
      await tx.obligation.updateMany({
        where: { employeeId: employee.id, status: "OPEN" },
        data: { status: "CANCELLED", revision: { increment: 1 } },
      });
      await tx.assignment.updateMany({
        where: { employeeId: employee.id },
        data: { active: false },
      });
      await tx.cycle.updateMany({
        where: { employeeId: employee.id, active: true },
        data: { active: false },
      });
      await tx.session.deleteMany({ where: { employeeId: employee.id } });
      const account = await tx.platformUser.findUnique({ where: { employeeId: employee.id } });
      if (account) { await tx.platformUser.update({ where: { id: account.id }, data: { active: false } }); await tx.authSession.deleteMany({ where: { userId: account.id } }); }
    } else if (previous && !previous.active) {
      const assignments = await tx.assignment.findMany({
        where: { employeeId: employee.id },
        include: {
          documentType: {
            include: { rules: { orderBy: { version: "desc" }, take: 1 } },
          },
        },
      });
      for (const a of assignments) {
        const rule = a.documentType.rules[0];
        if (!a.documentType.active || !rule || !applies(rule, employee))
          continue;
        await tx.assignment.update({
          where: { id: a.id },
          data: { active: true, ruleId: rule.id, assignedDate: localDate() },
        });
        await tx.obligation.create({
          data: {
            key: `${a.id}:reactivated:${randomUUID()}`,
            employeeId: employee.id,
            documentTypeId: a.documentTypeId,
            assignmentId: a.id,
            ruleId: rule.id,
            kind: "INITIAL",
            dueDate: addDays(localDate(), rule.initialDays),
          },
        });
      }
      await assignApplicable(tx, employee);
    } else await assignApplicable(tx, employee);
    await audit(
      tx,
      actor.id,
      id ? "EMPLOYEE_UPDATED" : "EMPLOYEE_CREATED",
      employee.id,
      { ...data, cpid: normalizeCpid(data.cpid) },
    );
    return employee;
  });
}
export async function saveDocument(
  actor: Employee,
  input: unknown,
  id?: string,
) {
  assert(isRh(actor), "Solo RH puede configurar documentos.", 403);
  const data = documentInput.parse(input);
  if (data.reviewTargetId && data.reviewTargetId !== "SELF")
    assert(
      await db.documentType.findUnique({ where: { id: data.reviewTargetId } }),
      "Documento de revisión inexistente.",
    );
  const { name, description, instructions, autoAssign, ...rule } =
    ruleData(data);
  return db.$transaction(async (tx) => {
    const type = id
      ? await tx.documentType.update({
          where: { id },
          data: { name, description, instructions, autoAssign },
        })
      : await tx.documentType.create({
          data: {
            code: `CUSTOM_${randomUUID()}`,
            name,
            description,
            instructions,
            autoAssign,
          },
        });
    const latest = await tx.rule.findFirst({
      where: { documentTypeId: type.id },
      orderBy: { version: "desc" },
    });
    await tx.rule.create({
      data: {
        ...rule,
        reviewTargetId:
          rule.reviewTargetId === "SELF" ? type.id : rule.reviewTargetId,
        documentTypeId: type.id,
        version: (latest?.version ?? 0) + 1,
      },
    });
    if (autoAssign) {
      for (const employee of await tx.employee.findMany({
        where: { active: true },
      })) {
        const current = await tx.rule.findFirstOrThrow({
          where: { documentTypeId: type.id },
          orderBy: { version: "desc" },
        });
        if (applies(current, employee)) await assign(tx, employee, type.id);
      }
    }
    await audit(tx, (actor as Employee & {accountId?:string}).accountId ?? actor.id, "RULE_VERSION_CREATED", type.id, {
      version: (latest?.version ?? 0) + 1,
      data,
    });
    return type;
  });
}
export function plannedCycleDates(
  cycle: Pick<Cycle, "issueDate" | "expiresDate" | "verified">,
  rule: Rule,
  today = localDate(),
  includesInitial = false,
) {
  if (!cycle.verified) return [];
  const dates: {
    kind: string;
    date: string;
    index: number | null;
    target: string;
  }[] = [];
  if (cycle.expiresDate)
    dates.push({
      kind: "RENEWAL",
      date: cycle.expiresDate,
      index: null,
      target: rule.documentTypeId,
    });
  if (cycle.issueDate && rule.reviewMonths && rule.reviewTargetId) {
    const horizon = addMonths(today, 24);
    for (let i = includesInitial?2:1; i <= (rule.reviewCount ?? (includesInitial?4:1000)); i++) {
      const date = addMonths(
        cycle.issueDate,
        (i-(includesInitial?1:0)) * rule.reviewMonths,
        rule.calendarMode,
      );
      if (cycle.expiresDate && date >= cycle.expiresDate) break;
      if (!includesInitial && !rule.reviewCount && date > horizon) break;
      dates.push({
        kind: "REVIEW",
        date,
        index: i,
        target: rule.reviewTargetId,
      });
    }
  }
  return dates;
}
export async function generateCycle(
  tx: Tx,
  cycle: Cycle,
  rule: Rule,
  today = localDate(),
) {
  const assignment = await tx.assignment.findUniqueOrThrow({
    where: {
      employeeId_documentTypeId: {
        employeeId: cycle.employeeId,
        documentTypeId: cycle.documentTypeId,
      },
    },
    include: { documentType: { select: { code: true } } },
  });
  for (const d of plannedCycleDates(cycle, rule, today,assignment.documentType.code==="LEY300")) {
    const key = `${cycle.id}:${rule.id}:${d.kind}:${d.index ?? 0}`;
    await tx.obligation.upsert({
      where: { key },
      update: {},
      create: {
        key,
        employeeId: cycle.employeeId,
        documentTypeId: d.target,
        assignmentId: assignment.id,
        ruleId: rule.id,
        cycleId: cycle.id,
        kind: d.kind,
        reviewIndex: d.index,
        dueDate: d.date,
      },
    });
  }
}
export async function openCycle(
  tx: Tx,
  employee: Employee,
  obligation: Obligation,
  issue: string | null,
  provided: string | null,
  origin = "APPROVAL",
) {
  // A new certificate uses the latest policy. Existing cycles retain their version.
  const rule = await tx.rule.findFirstOrThrow({
    where: { documentTypeId: obligation.documentTypeId },
    orderBy: { version: "desc" },
  });
  const expires = expiryDate(rule, issue, provided);
  if (issue && expires)
    assert(expires >= issue, "El vencimiento no puede preceder a la emisión.");
  if (rule.reviewMonths)
    assert(
      validDate(issue),
      "El ciclo de revisiones requiere emisión original verificada.",
    );
  const previous = await tx.cycle.findMany({
    where: {
      employeeId: employee.id,
      documentTypeId: obligation.documentTypeId,
      active: true,
    },
  });
  if (issue && previous.length)
    assert(
      previous.every((c) => !c.issueDate || issue > c.issueDate),
      "Una renovación requiere una emisión posterior a la anterior.",
    );
  for (const c of previous) {
    await tx.cycle.update({ where: { id: c.id }, data: { active: false } });
    await tx.obligation.updateMany({
      where: { cycleId: c.id, status: "OPEN" },
      data: { status: "CANCELLED", revision: { increment: 1 } },
    });
  }
  await tx.assignment.update({
    where: { id: obligation.assignmentId },
    data: { ruleId: rule.id },
  });
  const cycle = await tx.cycle.create({
    data: {
      employeeId: employee.id,
      documentTypeId: obligation.documentTypeId,
      ruleId: rule.id,
      issueDate: issue,
      expiresDate: expires,
      origin,
    },
  });
  await generateCycle(tx, cycle, rule);
  return cycle;
}
export async function reviewSubmission(
  actor: Employee,
  id: string,
  input: {
    approve: boolean;
    issueDate?: string | null;
    expiresDate?: string | null;
    reason?: string;
    initialBackgroundConfirmed?: boolean;
  },
) {
  assert(isRh(actor), "Solo RH puede aprobar entregas.", 403);
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT id FROM "${databaseSchema}"."hhrr_submissions" WHERE id=$1 FOR UPDATE`, id);
    const s = await tx.submission.findUniqueOrThrow({
      where: { id },
      include: { obligation: {include:{documentType:{select:{code:true}}}}, employee: true },
    });
    assert(
      s.status === "PENDING" &&
        s.obligation.status === "OPEN" &&
        s.employee.active,
      "Esta entrega ya no está pendiente.",
      409,
    );
    let issue = input.issueDate === undefined ? s.issueDate : input.issueDate,
      expires =
        input.expiresDate === undefined ? s.expiresDate : input.expiresDate;
    if (input.approve) {
      if(s.obligation.kind!=="REVIEW"&&s.obligation.documentType.code==="LEY300")assert(input.initialBackgroundConfirmed===true,"Confirme los antecedentes penales entregados junto a Ley 300 para la primera verificación.");
      if (issue)
        assert(
          validDate(issue) && issue <= localDate(),
          "La emisión debe ser una fecha válida y no futura.",
        );
      if (expires) assert(validDate(expires), "Vencimiento inválido.");
      if (s.obligation.kind !== "REVIEW") {
        // Verifying an imported emission alone leaves the initial bundle pending.
        // Attaching that bundle completes the same cycle, without changing its dates.
        const verifiedImport=s.obligation.kind==="INITIAL"&&s.obligation.documentType.code==="LEY300"?await tx.cycle.findFirst({where:{employeeId:s.employeeId,documentTypeId:s.obligation.documentTypeId,active:true,verified:true,origin:"VERIFIED_IMPORT"}}):null;
        if(verifiedImport&&(!issue||issue===verifiedImport.issueDate)) {
          assert(!expires||expires===verifiedImport.expiresDate,"El vencimiento debe coincidir con el ciclo verificado. Registre una renovación si corresponde a otra certificación.");
          issue=verifiedImport.issueDate;expires=verifiedImport.expiresDate;
        } else await openCycle(tx, s.employee, s.obligation, issue, expires);
      }
      await tx.obligation.update({
        where: { id: s.obligationId },
        data: {
          status: "FULFILLED",
          fulfilledDate: s.receivedDate,
          revision: { increment: 1 },
        },
      });
    } else assert(input.reason?.trim(), "Indique el motivo del rechazo.");
    const result = await tx.submission.update({
      where: { id },
      data: {
        status: input.approve ? "APPROVED" : "REJECTED",
        issueDate: issue,
        expiresDate: expires,
        reviewedAt: new Date(),
        reviewerId: (actor as Employee & {accountId?:string}).accountId ?? actor.id,
        reason: input.approve ? null : input.reason!.trim(),
      },
    });
    const document = await tx.documentType.findUniqueOrThrow({
      where: { id: s.obligation.documentTypeId },
    });
    const text = `${document.name}: ${input.approve ? "entrega aprobada" : `entrega rechazada. ${input.reason}`}.`;
    const { renderEmail } = await import("./domain");
    await tx.notification.create({
      data: {
        key: `decision:${id}`,
        kind: "DECISION",
        employeeId: s.employeeId,
        recipients: JSON.stringify([s.employee.email]),
        subject: input.approve ? "Documento aprobado" : "Corrija su entrega",
        text,
        html: renderEmail("Resultado de su entrega", [text]),
      },
    });
    await audit(
      tx,
      actor.id,
      input.approve ? "SUBMISSION_APPROVED" : "SUBMISSION_REJECTED",
      id,
      { obligationId: s.obligationId, issue, expires, reason: input.reason, initialBackgroundConfirmed:input.initialBackgroundConfirmed },
    );
    return result;
  });
  const message = await db.notification.findUniqueOrThrow({
    where: { key: `decision:${id}` },
  });
  await (await import("./mail")).deliverMessage(message.id);
  return result;
}
export async function ruleApplicationPreview(id: string, reader: Tx = db) {
  const rule = await reader.rule.findFirstOrThrow({
    where: { documentTypeId: id },
    orderBy: { version: "desc" },
    include: { documentType: { select: { code: true } } },
  });
  const obligations = await reader.obligation.findMany({
    where: {
      assignment: { documentTypeId: id, active: true },
      ruleId: { not: rule.id },
      status: "OPEN",
      employee: { active: true },
    },
    include: { cycle: true, employee: true, assignment: true },
  });
  const changes = obligations.map((o) => {
    let due = o.dueDate;
    if (o.kind === "INITIAL") {
      due = addDays(
        o.employee.hireDate > o.assignment.assignedDate
          ? o.employee.hireDate
          : o.assignment.assignedDate,
        rule.initialDays,
      );
    } else if (o.cycle) {
      const expires =
        rule.expiryMode === "FROM_ISSUE" && o.cycle.issueDate
          ? expiryDate(rule, o.cycle.issueDate, o.cycle.expiresDate)
          : rule.expiryMode === "NONE"
            ? null
            : o.cycle.expiresDate;
      const next = plannedCycleDates(
        { ...o.cycle, expiresDate: expires },
        rule,
        localDate(),rule.documentType.code==="LEY300",
      ).find((d) => d.kind === o.kind && d.index === o.reviewIndex);
      due = next?.date ?? "";
    }
    if (!applies(rule, o.employee)) due = "";
    return {
      id: o.id,
      employee: o.employee.name,
      cpid: o.employee.cpid,
      kind: o.kind,
      oldDate: o.dueDate,
      newDate: due,
      revision: o.revision,
    };
  });
  const cycles = await reader.cycle.findMany({
    where: {
      documentTypeId: id,
      active: true,
      ruleId: { not: rule.id },
      employee: { active: true },
    },
    include: { employee: true, obligations: true },
  });
  for (const cycle of cycles) {
    if (!applies(rule, cycle.employee)) continue;
    const expires =
      rule.expiryMode === "NONE"
        ? null
        : rule.expiryMode === "FROM_ISSUE"
          ? expiryDate(rule, cycle.issueDate, cycle.expiresDate)
          : cycle.expiresDate;
    if (rule.reviewMonths)
      assert(
        cycle.issueDate,
        "Verifique la emisión del documento base antes de aplicar revisiones.",
      );
    for (const next of plannedCycleDates(
      { ...cycle, expiresDate: expires },
      rule,
      localDate(),rule.documentType.code==="LEY300",
    )) {
      if (
        cycle.obligations.some(
          (o) =>
            ["OPEN", "FULFILLED"].includes(o.status) &&
            o.kind === next.kind &&
            o.reviewIndex === next.index &&
            o.documentTypeId === next.target,
        )
      )
        continue;
      changes.push({
        id: `new:${cycle.id}:${next.kind}:${next.index ?? 0}`,
        employee: cycle.employee.name,
        cpid: cycle.employee.cpid,
        kind: next.kind,
        oldDate: "",
        newDate: next.date,
        revision: 0,
      });
    }
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({ rule: rule.id, changes }))
    .digest("hex");
  return { ruleId: rule.id, version: rule.version, changes, digest };
}
export async function applyCurrentRule(
  actor: Employee,
  id: string,
  digest: string,
) {
  assert(isRh(actor), "Solo RH puede aplicar reglas.", 403);
  return db.$transaction(async (tx) => {
    // Preview is recomputed before the write. The transaction prevents approval races.
    const preview = await ruleApplicationPreview(id, tx);
    assert(
      preview.digest === digest,
      "Los datos cambiaron. Genere otra vista previa.",
      409,
    );
    const rule = await tx.rule.findUniqueOrThrow({
      where: { id: preview.ruleId },
    });
    const cycles = await tx.cycle.findMany({
      where: {
        documentTypeId: id,
        active: true,
        ruleId: { not: rule.id },
        employee: { active: true },
      },
      include: { employee: true },
    });
    for (const c of cycles) {
      assert(
        !(await tx.submission.count({
          where: { obligation: { cycleId: c.id }, status: "PENDING" },
        })),
        "Apruebe o rechace las entregas en revisión antes de recalcular.",
      );
      const old = await tx.obligation.findMany({ where: { cycleId: c.id } });
      if (!applies(rule, c.employee)) {
        await tx.cycle.update({ where: { id: c.id }, data: { active: false } });
        await tx.obligation.updateMany({
          where: { cycleId: c.id, status: "OPEN" },
          data: { status: "CANCELLED", revision: { increment: 1 } },
        });
        await tx.assignment.updateMany({
          where: { employeeId: c.employeeId, documentTypeId: id },
          data: { active: false },
        });
        continue;
      }
      const expires =
        rule.expiryMode === "NONE"
          ? null
          : rule.expiryMode === "FROM_ISSUE" && c.issueDate
            ? expiryDate(rule, c.issueDate, c.expiresDate)
            : c.expiresDate;
      const cycle = await tx.cycle.update({
        where: { id: c.id },
        data: { ruleId: rule.id, expiresDate: expires },
      });
      await tx.obligation.updateMany({
        where: { cycleId: c.id, status: "OPEN" },
        data: { status: "CANCELLED", revision: { increment: 1 } },
      });
      await generateCycle(tx, cycle, rule);
      // Completed anniversaries are retained even when a policy version changes.
      for (const o of old.filter((o) => o.status === "FULFILLED"))
        await tx.obligation.updateMany({
          where: {
            cycleId: c.id,
            ruleId: rule.id,
            kind: o.kind,
            reviewIndex: o.reviewIndex,
            documentTypeId: o.documentTypeId,
          },
          data: { status: "FULFILLED", fulfilledDate: o.fulfilledDate },
        });
    }
    for (const change of preview.changes.filter((o) => o.kind === "INITIAL")) {
      assert(
        !(await tx.submission.count({
          where: { obligationId: change.id, status: "PENDING" },
        })),
        "Hay una entrega inicial en revisión.",
      );
      if (!change.newDate) {
        const o = await tx.obligation.update({
          where: { id: change.id },
          data: { status: "CANCELLED", revision: { increment: 1 } },
        });
        await tx.assignment.update({
          where: { id: o.assignmentId },
          data: { active: false },
        });
        continue;
      }
      await tx.obligation.update({
        where: { id: change.id },
        data: {
          ruleId: rule.id,
          dueDate: change.newDate,
          revision: { increment: 1 },
        },
      });
    }
    await tx.assignment.updateMany({
      where: { documentTypeId: id, active: true },
      data: { ruleId: rule.id },
    });
    await audit(tx, (actor as Employee & {accountId?:string}).accountId ?? actor.id, "RULE_APPLIED", id, preview);
    return preview;
  });
}
export async function changeDueDate(
  actor: Employee,
  id: string,
  dueDate: string,
  reason: string,
) {
  assert(isRh(actor), "Solo RH puede ajustar plazos.", 403);
  assert(validDate(dueDate) && reason.trim(), "Indique fecha válida y motivo.");
  return db.$transaction(async (tx) => {
    const o = await tx.obligation.findUniqueOrThrow({ where: { id } });
    assert(o.status === "OPEN", "Obligación cerrada.");
    const r = await tx.obligation.update({
      where: { id },
      data: { dueDate, revision: { increment: 1 } },
    });
    await audit(tx, (actor as Employee & {accountId?:string}).accountId ?? actor.id, "DUE_DATE_UPDATED", id, {
      previous: o.dueDate,
      dueDate,
      reason,
    });
    return r;
  });
}
