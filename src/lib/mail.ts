import { db } from "./db";
import { emailProvider, emailEnabled } from "./config";
import {
  assert,
  renderEmail,
  localDate,
  localHour,
  currentStage,
  displayDate,
  stateOf,
} from "./domain";
import { Resend } from "resend";
import { reconcileProviderEvents } from "./provider-events";
import type { Notification } from "../generated/prisma/client";

export async function queueMessage(
  key: string,
  kind: string,
  recipients: string[],
  subject: string,
  lines: string[],
  employeeId?: string,
  now = new Date(),
) {
  return db.notification.upsert({
    where: { key },
    update: {},
    create: {
      key,
      kind,
      recipients: JSON.stringify([...new Set(recipients)]),
      subject,
      text: lines.join("\n"),
      html: renderEmail(subject, lines),
      employeeId,
      nextAttemptAt: now,
    },
  });
}
export async function deliverMessage(id: string, now = new Date()) {
  const before = await db.notification.findUnique({ where: { id } });
  if (!before) return;
  if (
    before.kind === "AUTH" &&
    ["PENDING", "FAILED", "SENDING"].includes(before.status)
  ) {
    const challenge = await db.challenge.findUnique({
      where: { id: before.key.slice(5) },
    });
    if (!challenge || challenge.consumed || challenge.expiresAt <= now) {
      await db.notification.update({
        where: { id },
        data: {
          status: "CANCELLED",
          leaseUntil: null,
          error: "Código consumido o vencido; solicite uno nuevo.",
        },
      });
      return;
    }
  }
  if (
    before.status === "SENDING" &&
    before.firstAttemptAt &&
    now.getTime() - before.firstAttemptAt.getTime() >= 24 * 3600000
  ) {
    await db.notification.update({
      where: { id },
      data: {
        status: "UNCERTAIN",
        error:
          "El intento ambiguo superó la ventana de idempotencia. Compruebe el proveedor antes de reenviar.",
      },
    });
    return;
  }
  if (before.status === "FAILED" && before.attempts >= 5) return;
  if (before.status === "SENDING" && before.attempts >= 5) {
    await db.notification.update({
      where: { id },
      data: {
        status: "UNCERTAIN",
        leaseUntil: null,
        error:
          "El último intento quedó sin confirmar y se agotaron los cinco intentos. Compruebe el proveedor.",
      },
    });
    return;
  }
  if (
    ["COMPLIANCE", "SUPERVISOR", "REVIEW_DIGEST", "WEEKLY"].includes(
      before.kind,
    ) &&
    (localHour(now) < 8 || localHour(now) >= 18)
  )
    return;
  const claimed = await db.notification.updateMany({
    where: {
      id,
      AND: [
        {
          OR: [
            { status: "PENDING" },
            { status: "FAILED", attempts: { lt: 5 } },
            { status: "SENDING" },
          ],
        },
      ],
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: {
      status: "SENDING",
      leaseUntil: new Date(now.getTime() + 60000),
      firstAttemptAt: before.firstAttemptAt ?? now,
      attempts: { increment: 1 },
    },
  });
  if (!claimed.count) return;
  let message = await db.notification.findUniqueOrThrow({ where: { id } });
  try {
    if (message.kind === "COMPLIANCE" && message.attempts === 1) {
      const events = await db.notificationEvent.findMany({
        where: { notificationId: id },
        include: {
          obligation: {
            include: {
              employee: true,
              submissions: { where: { status: "PENDING" } },
              documentType: true,
            },
          },
        },
      });
      const usable = events.filter(
        (e) =>
          e.obligation.status === "OPEN" &&
          e.obligation.employee.active &&
          !e.obligation.submissions.length,
      );
      if (!usable.length) {
        await db.notification.update({
          where: { id },
          data: { status: "CANCELLED", leaseUntil: null },
        });
        await db.notificationEvent.deleteMany({
          where: { notificationId: id },
        });
        return;
      }
      const removed = events.filter((e) => !usable.includes(e));
      if (removed.length)
        await db.notificationEvent.deleteMany({
          where: { id: { in: removed.map((e) => e.id) } },
        });
      const lines = usable.map(
        (e) =>
          `${e.obligation.documentType.name}${e.obligation.reviewIndex ? ` · revisión ${e.obligation.reviewIndex}` : ""}: plazo ${displayDate(e.obligation.dueDate)} · ${stateOf(e.obligation, localDate(now)).replaceAll("_", " ").toLowerCase()}.`,
      );
      message = await db.notification.update({
        where: { id },
        data: {
          text: lines.join("\n"),
          html: renderEmail(message.subject, lines),
        },
      });
    }
    if (message.kind !== "AUTH" && message.employeeId) {
      const e = await db.employee.findUnique({
        where: { id: message.employeeId },
      });
      if (!e?.active) {
        await db.notification.update({
          where: { id },
          data: { status: "CANCELLED", leaseUntil: null },
        });
        return;
      }
    }
    if (emailProvider === "preview" || !emailEnabled) {
      await db.notification.update({
        where: { id },
        data: {
          status: emailProvider === "preview" ? "PREVIEW" : "DISABLED",
          providerId: emailProvider === "preview" ? `preview:${id}` : null,
          ...(emailProvider === "preview" ? {} : { attempts: 0, firstAttemptAt: null }),
          leaseUntil: null,
          error: null,
        },
      });
    } else {
      assert(
        emailProvider === "resend" &&
          process.env.RESEND_API_KEY &&
          process.env.EMAIL_FROM,
        "Configure Resend y el remitente verificado.",
      );
      if (
        message.firstAttemptAt &&
        now.getTime() - message.firstAttemptAt.getTime() >= 24 * 3600000
      ) {
        await db.notification.update({
          where: { id },
          data: {
            status: "UNCERTAIN",
            leaseUntil: null,
            error: "Compruebe el envío antes de reintentar fuera de 24 horas.",
          },
        });
        return;
      }
      const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
        {
          from: process.env.EMAIL_FROM,
          to: JSON.parse(message.recipients),
          subject: message.subject,
          html: message.html,
          text: message.text,
        },
        { idempotencyKey: message.id, signal: AbortSignal.timeout(20000) },
      );
      if (result.error) throw new Error(result.error.message);
      await db.$transaction(async (tx) => {
        await tx.notification.update({
          where: { id },
          data: { providerId: result.data!.id, leaseUntil: null, error: null },
        });
        await reconcileProviderEvents(tx, result.data!.id);
        await tx.notification.updateMany({
          where: { id, status: "SENDING" },
          data: { status: "ACCEPTED" },
        });
      });
    }
    await db.notificationEvent.updateMany({
      where: { notificationId: id },
      data: { status: "SENT" },
    });
  } catch (error) {
    const attempts = message.attempts;
    await db.notification.update({
      where: { id },
      data: {
        status: "FAILED",
        leaseUntil: null,
        nextAttemptAt: new Date(
          now.getTime() +
            [1, 5, 15, 60, 180][Math.min(attempts - 1, 4)] * 60000,
        ),
        error: error instanceof Error ? error.message : "Error de envío",
      },
    });
  }
}
export async function processOutbox(
  now = new Date(),
  renewLease?: () => Promise<void>,
) {
  const messages = await db.notification.findMany({
    where: {
      AND: [
        {
          OR: [
            { status: "PENDING" },
            { status: "FAILED", attempts: { lt: 5 } },
            { status: "SENDING" },
          ],
        },
      ],
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const m of messages) {
    await renewLease?.();
    await deliverMessage(m.id, now);
  }
}
export async function prepareScheduledMessages(now = new Date()) {
  const hour = localHour(now);
  if (hour < 8 || hour >= 18) return;
  const today = localDate(now);
  const monday = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();
  const unsent = await db.notification.findMany({
    where: {
      status: "PENDING",
      firstAttemptAt: null,
      kind: { in: ["COMPLIANCE", "SUPERVISOR", "REVIEW_DIGEST", "WEEKLY"] },
    },
  });
  for (const message of unsent) {
    if (message.key.endsWith(`:${message.kind === "WEEKLY" ? monday : today}`))
      continue;
    await db.$transaction(async (tx) => {
      await tx.notification.update({
        where: { id: message.id },
        data: {
          status: "CANCELLED",
          error: "Aviso anterior omitido al recuperar la etapa vigente.",
        },
      });
      await tx.notificationEvent.deleteMany({
        where: { notificationId: message.id },
      });
    });
  }
  const employees = await db.employee.findMany({
    where: { active: true },
    include: {
      obligations: {
        where: {
          status: "OPEN",
          assignment: { active: true },
          OR: [{ cycleId: null }, { cycle: { active: true, verified: true } }],
        },
        include: {
          rule: true,
          documentType: true,
          submissions: { where: { status: "PENDING" } },
        },
      },
    },
  });
  const notified = new Set<string>();
  for (const employee of employees) {
    const key = `compliance:${employee.id}:${today}`;
    if (await db.notification.findUnique({ where: { key } })) continue;
    const candidates: {
      o: (typeof employee.obligations)[number];
      stage: string;
    }[] = [];
    for (const o of employee.obligations) {
      if (o.submissions.length) continue;
      const stage = currentStage(
        o.dueDate,
        today,
        JSON.parse(o.rule.reminders),
        o.rule.overdueDays,
      );
      if (!stage) continue;
      const versionStage = `${o.ruleId}:${o.revision}:${stage}`;
      if (
        await db.notificationEvent.findUnique({
          where: {
            obligationId_stage: { obligationId: o.id, stage: versionStage },
          },
        })
      )
        continue;
      candidates.push({ o, stage: versionStage });
    }
    if (!candidates.length) continue;
    await db.$transaction(async (tx) => {
      const message = await tx.notification.create({
        data: {
          key,
          kind: "COMPLIANCE",
          employeeId: employee.id,
          recipients: JSON.stringify([employee.email]),
          subject: "Documentación RH: próximos plazos y pendientes",
          text: "",
          html: "",
          nextAttemptAt: now,
        },
      });
      for (const c of candidates) {
        await tx.notificationEvent.create({
          data: {
            obligationId: c.o.id,
            stage: c.stage,
            notificationId: message.id,
          },
        });
        const raw = c.stage.split(":").at(-1)!;
        const thresholds = (JSON.parse(c.o.rule.reminders) as number[]).filter(
          (d) => raw.startsWith("W") || Number(raw.slice(1)) < d,
        );
        for (const d of thresholds)
          await tx.notificationEvent.upsert({
            where: {
              obligationId_stage: {
                obligationId: c.o.id,
                stage: `${c.o.ruleId}:${c.o.revision}:D${d}`,
              },
            },
            update: {},
            create: {
              obligationId: c.o.id,
              stage: `${c.o.ruleId}:${c.o.revision}:D${d}`,
              status: "SKIPPED",
            },
          });
      }
    });
    notified.add(employee.id);
  }
  for (const supervisor of employees.filter((e) => e.role === "SUPERVISOR")) {
    const team = employees.filter(
      (e) => e.supervisorId === supervisor.id && notified.has(e.id),
    );
    if (team.length)
      await queueMessage(
        `supervisor:${supervisor.id}:${today}`,
        "SUPERVISOR",
        [supervisor.email],
        "Pendientes de documentación de su equipo",
        team.flatMap((e) =>
          e.obligations
            .filter(
              (o) =>
                !o.submissions.length &&
                currentStage(
                  o.dueDate,
                  today,
                  JSON.parse(o.rule.reminders),
                  o.rule.overdueDays,
                ),
            )
            .map(
              (o) =>
                `${e.name} · ${o.documentType.name} · ${displayDate(o.dueDate)}.`,
            ),
        ),
        supervisor.id,
        now,
      );
  }
  const pending = await db.submission.findMany({
    where: {
      status: "PENDING",
      employee: { active: true },
      obligation: { status: "OPEN" },
    },
    include: {
      employee: true,
      obligation: { include: { documentType: true } },
    },
  });
  const administrators = await db.platformUser.findMany({ where: { active: true, role: { in: ["RH", "SUPERADMIN"] } }, select: { id: true, email: true } });
  const targets = [...administrators.map(a=>({...a,account:true})), ...employees.filter(e=>e.role==="RH"&&!administrators.some(a=>a.email===e.email)).map(e=>({id:e.id,email:e.email,account:false}))];
  for (const rh of targets) {
    if (pending.length)
      await queueMessage(
        `reviews:${rh.id}:${today}`,
        "REVIEW_DIGEST",
        [rh.email],
        `${pending.length} entrega(s) esperan aprobación`,
        pending.map(
          (s) =>
            `${s.employee.name} · ${s.obligation.documentType.name} · entregado ${displayDate(s.receivedDate)}.`,
        ),
        rh.account ? undefined : rh.id,
        now,
      );
    const all = employees.flatMap((e) => e.obligations);
    await queueMessage(
      `weekly:${rh.id}:${monday}`,
      "WEEKLY",
      [rh.email],
      "Resumen semanal de cumplimiento RH",
      [
        `Semana del ${displayDate(monday)}. ${employees.length} empleados activos.`,
        `${all.filter((o) => o.dueDate < today).length} obligaciones vencidas; ${pending.length} entregas en revisión; ${all.length} obligaciones abiertas.`,
        ...employees
          .filter((e) => e.obligations.some((o) => o.dueDate < today))
          .map(
            (e) =>
              `${e.name} · ${e.site}: ${e.obligations.filter((o) => o.dueDate < today).length} vencida(s).`,
          ),
      ],
      rh.account ? undefined : rh.id,
      now,
    );
    if (rh.account) await db.notification.updateMany({where:{key:{in:[`reviews:${rh.id}:${today}`,`weekly:${rh.id}:${monday}`]}},data:{accountId:rh.id}});
  }
}
export function safeMailboxMessage(message: Notification) {
  return {
    id: message.id,
    kind: message.kind,
    subject: message.subject,
    text: message.text,
    recipients: JSON.parse(message.recipients),
    createdAt: message.createdAt,
    status: message.status,
    error: message.error,
    attempts: message.attempts,
  };
}
