import { NextRequest, NextResponse } from "next/server";
import {bulkAssignments} from "@/lib/bulk-assignments";
import { Prisma } from "@/generated/prisma/client";
import { ZodError, z } from "zod";
import { Resend } from "resend";
import { db } from "@/lib/db";
import { ensureOperational } from "@/lib/platform-maintenance";
import {
  currentUser,
  requestCode,
  verifyCode,
  mutationGuard,
  localhostOnly,
} from "@/lib/auth";
import { assert, AppError, localDate } from "@/lib/domain";
import {
  isRh,
  visibility,
  saveEmployee,
  saveDocument,
  assign,
  audit,
  reviewSubmission,
  ruleApplicationPreview,
  applyCurrentRule,
  changeDueDate,
} from "@/lib/compliance";
import { submitFiles, readAttachment } from "@/lib/storage";
import {
  verifyImportedLaw,
} from "@/lib/importer";
import { reportRows, exportReport } from "@/lib/reports";
import { safeMailboxMessage } from "@/lib/mail";
import { recordProviderEvent } from "@/lib/provider-events";
import { tick } from "@/lib/worker";
import { createBackup } from "@/lib/backup";
import { emailProvider, localMode, cloudStorage } from "@/lib/config";
import { platformAuth } from "@/lib/platform-auth";
import { createActivation,savePlatformUser } from "@/lib/platform-users";
import { prepareUpload,completeUpload } from "@/lib/cloud-upload";
import { dashboardData } from "@/lib/dashboard";
import { advancedReport,exportAdvancedReport,receipt } from "@/lib/advanced-reports";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
const json = (data: unknown) =>
  NextResponse.json(data, {
    headers: { "Cache-Control": "private, no-store" },
  });
async function handle(request: NextRequest, context: Context) {
  try {
    const path = (await context.params).path,
      route = path.join("/"),
      method = request.method;
    await ensureOperational();
    if (route === "webhooks/resend" && method === "POST") {
      assert(process.env.RESEND_WEBHOOK_SECRET, "Webhook sin configurar.", 404);
      const payload = await request.text(),
        headers = {
          id: request.headers.get("svix-id") ?? "",
          timestamp: request.headers.get("svix-timestamp") ?? "",
          signature: request.headers.get("svix-signature") ?? "",
        };
      let event;
      try {
        event = new Resend(process.env.RESEND_API_KEY).webhooks.verify({
          payload,
          headers,
          webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
        });
      } catch {
        throw new AppError("Firma inválida.", 400);
      }
      const status =
        event.type === "email.delivered"
          ? "DELIVERED"
          : ["email.bounced", "email.complained"].includes(event.type)
            ? "BOUNCED"
            : null;
      if (status && "email_id" in event.data)
        await recordProviderEvent(headers.id, event.data.email_id, status);
      return json({ ok: true });
    }
    if (method !== "GET") mutationGuard(request);
    if (route === "auth/request" && method === "POST")
      { assert(localMode && process.env.ALLOW_LEGACY_TEST_SESSION === "true", "Ruta no habilitada.", 404); return json(await requestCode(request, await request.json())); }
    if (route === "auth/verify" && method === "POST")
      { assert(localMode && process.env.ALLOW_LEGACY_TEST_SESSION === "true", "Ruta no habilitada.", 404); return await verifyCode(
        await request.json(),
        request.nextUrl.protocol === "https:",
      ); }
    if (route === "dev/mailbox" && method === "GET") {
      localhostOnly(request);
      assert(
        emailProvider === "preview",
        "La bandeja local requiere correo simulado.",
        404,
      );
      const messages = await db.notification.findMany({
        where: { status: "PREVIEW" },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return json(messages.map(safeMailboxMessage));
    }
    const user = await currentUser(request);
    if (route === "auth/logout" && method === "POST") {
      return platformAuth.handler(new Request(new URL("/api/auth/sign-out", request.url),{method:"POST",headers:request.headers}));
      /* Legacy test sessions are never accepted in production.
      await db.session.deleteMany({
        where: { id: tokenHash(request.cookies.get("rh-session")!.value) },
      });
      const result = json({ ok: true });
      result.cookies.delete("rh-session");
      return result;
      */
    }
    if (route === "state" && method === "GET") {
      const [
        employees,
        documents,
        obligations,
        settings,
        imports,
        notifications,
        audits,
        queue,
      ] = await Promise.all([
        db.employee.findMany({
          where: visibility(user),
          orderBy: { name: "asc" },
        }),
        db.documentType.findMany({
          include: { rules: { orderBy: { version: "desc" }, take: 1 } },
          orderBy: { name: "asc" },
        }),
        reportRows(user, new URLSearchParams()),
        isRh(user) ? db.setting.findMany({where:{key:{in:["heartbeat","lastBackup"]}}}) : Promise.resolve([]),
        Promise.resolve([]),
        isRh(user)
          ? db.notification.findMany({
              where: { kind: { not: "AUTH" } },
              orderBy: { createdAt: "desc" },
              take: 100,
            })
          : db.notification.findMany({where:{kind:{not:"AUTH"},OR:[{employeeId:user.id},{accountId:user.accountId}]},orderBy:{createdAt:"desc"},take:100}),
        isRh(user)
          ? db.audit.findMany({ orderBy: { createdAt: "desc" }, take: 50 })
          : Promise.resolve([]),
        isRh(user)
          ? db.notification.groupBy({ by: ["status"], _count: { _all: true } })
          : Promise.resolve([]),
      ]);
      return json({
        user,
        storageProvider: cloudStorage ? "supabase" : "local",
        dashboard: await dashboardData(user),
        employees: employees.map((e) =>
          isRh(user) || e.id === user.id
            ? e
            : {
                id: e.id,
                cpid: e.cpid,
                name: e.name,
                site: e.site,
                position: e.position,
                role: e.role,
                active: e.active,
                source: e.source,
                supervisorId: e.supervisorId,
              },
        ),
        documents: documents.map((d) => ({
          ...d,
          rule: d.rules[0]
            ? {
                ...d.rules[0],
                reminders: JSON.parse(d.rules[0].reminders),
                sites: JSON.parse(d.rules[0].sites),
                positions: JSON.parse(d.rules[0].positions),
              }
            : null,
          rules: undefined,
        })),
        obligations,
        settings: Object.fromEntries(
          settings.map((s) => [s.key, JSON.parse(s.value)]),
        ),
        imports,
        notifications: notifications.map(safeMailboxMessage),
        audits,
        today: localDate(),
        localMode,
        emailProvider,
        queue: Object.fromEntries(queue.map((s) => [s.status, s._count._all])),
      });
    }
    if (path[0] === "files" && path[1] && method === "GET")
      return await readAttachment(user, path[1]);
    if (["imports","import-rows"].includes(path[0])) throw new AppError("La importación está cerrada.",404);
    if (route === "dashboard" && method === "GET") return json(await dashboardData(user,request.nextUrl.searchParams));
    if (route === "uploads" && method === "POST") return json(await prepareUpload(user,await request.json()));
    if (route === "submissions/complete" && method === "POST") return json(await completeUpload(user,await request.json()));
    if (path[0] === "submissions" && path[2] === "receipt" && method === "GET") return receipt(user,path[1]);
    if (route === "notifications/read" && method === "POST") { const {id}=z.object({id:z.string()}).parse(await request.json());await db.notification.updateMany({where:{id,OR:[{employeeId:user.id},{accountId:user.accountId}]},data:{readAt:new Date()}});return json({ok:true}); }
    if (route === "submissions" && method === "POST") {
      assert(
        Number(request.headers.get("content-length") ?? 0) <= 55 * 1024 * 1024,
        "Entrega demasiado grande.",
        413,
      );
      return json(await submitFiles(user, await request.formData()));
    }
    if (
      path[0] === "submissions" &&
      path[2] === "review" &&
      method === "POST"
    ) {
      const input = z
        .object({
          approve: z.boolean(),
          issueDate: z.string().nullable().optional(),
          expiresDate: z.string().nullable().optional(),
            reason: z.string().max(3000).optional(),
            initialBackgroundConfirmed: z.boolean().optional(),
        })
        .parse(await request.json());
      return json(await reviewSubmission(user, path[1], input));
    }
    if (route === "reports" && method === "GET")
      return json(request.nextUrl.searchParams.has("kind") ? await advancedReport(user,request.nextUrl.searchParams) : await reportRows(user, request.nextUrl.searchParams));
    if (route === "reports/export" && method === "GET")
      return request.nextUrl.searchParams.has("kind") ? exportAdvancedReport(user,request.nextUrl.searchParams) : exportReport(user, request.nextUrl.searchParams);
    assert(isRh(user), "Esta acción requiere acceso RH.", 403);
    if (route === "assignments/bulk-preview" && method === "POST") return json(await bulkAssignments(user,await request.json()));
    if (route === "assignments/bulk-confirm" && method === "POST") return json(await bulkAssignments(user,await request.json(),true));
    if (route === "reviewers" && method === "GET") return json(await db.platformUser.findMany({where:{active:true,role:{in:["RH","SUPERADMIN"]}},select:{id:true,name:true}}));
    if (route === "users" && method === "GET") return json(await db.platformUser.findMany({where:user.role==="SUPERADMIN"?{}:{role:{in:["EMPLOYEE","SUPERVISOR"]}},select:{id:true,name:true,email:true,role:true,active:true,employeeId:true,twoFactorEnabled:true,createdAt:true},orderBy:{name:"asc"}}));
    if (route === "users" && method === "POST") {const account=await savePlatformUser(user,await request.json());return json({...account,activationUrl:await createActivation(account.id)});}
    if (path[0] === "users" && path[1] && path.length===2 && method==="PATCH") return json(await savePlatformUser(user,await request.json(),path[1]));
    if (path[0] === "users" && path[2]==="activation" && method==="POST") {const account=await db.platformUser.findUniqueOrThrow({where:{id:path[1]}});assert(user.role==="SUPERADMIN"||!["RH","SUPERADMIN"].includes(account.role),"Solo superadmin administra cuentas RH.",403);return json({activationUrl:await createActivation(account.id,"RESET")});}
    if (path[0] === "users" && path[2]==="sessions" && method==="DELETE") {const account=await db.platformUser.findUniqueOrThrow({where:{id:path[1]}});assert(user.role==="SUPERADMIN"||!["RH","SUPERADMIN"].includes(account.role),"Solo superadmin administra cuentas RH.",403);await db.authSession.deleteMany({where:{userId:account.id}});return json({ok:true});}
    if (path[0] === "users" && path[2]==="reset-mfa" && method==="POST") {
      assert(user.role==="SUPERADMIN"&&path[1]!==user.accountId,"Solo superadmin puede restablecer la autenticadora de otra cuenta.",403);
      await db.$transaction(async tx=>{await tx.platformUser.update({where:{id:path[1]},data:{twoFactorEnabled:false}});await tx.twoFactor.deleteMany({where:{userId:path[1]}});await tx.authSession.deleteMany({where:{userId:path[1]}});await audit(tx,user.accountId,"MFA_RESET",path[1],{});});
      return json({activationUrl:await createActivation(path[1],"RESET")});
    }
    if (path[0] === "submissions" && path[2]==="assign-reviewer" && method==="PATCH") {const data=z.object({reviewerId:z.string().nullable()}).parse(await request.json());if(data.reviewerId)assert(await db.platformUser.count({where:{id:data.reviewerId,active:true,role:{in:["RH","SUPERADMIN"]}}}),"Responsable inválido.");const result=await db.submission.updateMany({where:{id:path[1],status:"PENDING"},data:{assignedReviewerId:data.reviewerId}});assert(result.count,"Entrega ya revisada.",409);await db.$transaction(tx=>audit(tx,user.accountId,"REVIEW_ASSIGNED",path[1],data));return json({ok:true});}
    if (route === "employees" && method === "POST")
      return json(await saveEmployee(user, await request.json()));
    if (
      path[0] === "employees" &&
      path[1] &&
      path.length === 2 &&
      method === "PATCH"
    )
      return json(await saveEmployee(user, await request.json(), path[1]));
    if (
      path[0] === "employees" &&
      path[2] === "verify-law" &&
      method === "POST"
    ) {
      const input = z
        .object({ issueDate: z.string(), confirmLegacy: z.boolean() })
        .parse(await request.json());
      return json(
        await verifyImportedLaw(
          user,
          path[1],
          input.issueDate,
          input.confirmLegacy,
        ),
      );
    }
    if (route === "documents" && method === "POST")
      return json(await saveDocument(user, await request.json()));
    if (path[0] === "documents" && path[1] && method === "PATCH")
      return json(await saveDocument(user, await request.json(), path[1]));
    if (route === "assignments" && method === "POST") {
      const input = z
        .object({
          employeeId: z.uuid(),
          documentTypeId: z.uuid(),
          dueDate: z.string().optional(),
        })
        .parse(await request.json());
      const employee = await db.employee.findUniqueOrThrow({
        where: { id: input.employeeId },
      });
      assert(employee.active, "Empleado inactivo.");
      if (input.dueDate)
        assert(
          (await import("@/lib/domain")).validDate(input.dueDate),
          "Plazo inválido.",
        );
      return json(
        await db.$transaction(async (tx) => {
          const result = await assign(
            tx,
            employee,
            input.documentTypeId,
            input.dueDate,
          );
          await audit(tx, user.id, "DOCUMENT_ASSIGNED", result.id, input);
          return result;
        }),
      );
    }
    if (path[0] === "obligations" && path[2] === "due" && method === "PATCH") {
      const input = z
        .object({ dueDate: z.string(), reason: z.string().min(1).max(1000) })
        .parse(await request.json());
      return json(
        await changeDueDate(user, path[1], input.dueDate, input.reason),
      );
    }
    if (path[0] === "rules" && path[2] === "preview" && method === "GET")
      return json(await ruleApplicationPreview(path[1]));
    if (path[0] === "rules" && path[2] === "apply" && method === "POST") {
      const input = z
        .object({ digest: z.string() })
        .parse(await request.json());
      return json(await applyCurrentRule(user, path[1], input.digest));
    }
    if (route === "motor/tick" && method === "POST") return json(await tick());
    if (route === "backups" && method === "POST")
      return json(await createBackup());
    throw new AppError("Ruta no encontrada.", 404);
  } catch (error) {
    if (error instanceof AppError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    if (error instanceof ZodError)
      return NextResponse.json(
        { error: error.issues.map((i) => i.message).join(" ") },
        { status: 400 },
      );
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        {
          error:
            error.code === "P2002"
              ? "Este registro ya existe. Revise el CPID o actualice la pantalla."
              : error.code === "P2025"
                ? "Registro inexistente."
                : "No fue posible guardar el cambio.",
        },
        { status: error.code === "P2025" ? 404 : 409 },
      );
    }
    console.error("[RH] API", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json(
      { error: "Ocurrió un error. Consulte el diagnóstico del servidor." },
      { status: 500 },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
