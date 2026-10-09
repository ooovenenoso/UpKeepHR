import { db } from "./db";
import { visibility, isRh } from "./compliance";
import { stateOf, daysBetween, localDate } from "./domain";
import {brandedBytes} from "./branded-export";
import type { Employee } from "../generated/prisma/client";
export async function reportRows(viewer: Employee, params: URLSearchParams) {
  const today = localDate();
  const rows = await db.obligation.findMany({
    where: {
      employee: {
        ...visibility(viewer),
        ...(params.get("site") ? { site: params.get("site")! } : {}),
        ...(params.get("position")
          ? { position: params.get("position")! }
          : {}),
        ...(params.get("supervisor")
          ? { supervisorId: params.get("supervisor")! }
          : {}),
        ...(params.get("source") ? { source: params.get("source")! } : {}),
      },
      ...(params.get("document")
        ? { documentTypeId: params.get("document")! }
        : {}),
      ...(params.get("employee")
        ? { employeeId: params.get("employee")! }
        : {}),
    },
    include: {
      employee: true,
      documentType: true,
      submissions: {
        orderBy: { submittedAt: "desc" },
        include: { files: true },
      },
      cycle: true,
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
  });
  return rows
    .map((o) => ({
      id: o.id,
      employeeId: o.employeeId,
      name: o.employee.name,
      cpid: o.employee.cpid,
      site: o.employee.site,
      position: o.employee.position,
      document: o.documentType.name,
      documentTypeId: o.documentTypeId,
      kind: o.kind,
      reviewIndex: o.reviewIndex,
      dueDate: o.dueDate,
      fulfilledDate: o.fulfilledDate,
      days: daysBetween(o.dueDate, today),
      state: stateOf(o, today),
      cycleId: o.cycleId,
      source: o.employee.source,
      origin:
        o.cycle?.origin ?? (o.employee.source === "IMPORT" ? "IMPORT" : null),
      submissions: o.submissions.map((s) =>
        isRh(viewer) || o.employeeId === viewer.id
          ? {
              ...s,
              files: s.files.map((f) => ({
                id: f.id,
                filename: f.filename,
                mime: f.mime,
                size: f.size,
              })),
            }
          : { id: s.id, status: s.status, receivedDate: s.receivedDate },
      ),
    }))
    .filter(
      (r) =>
        (!params.get("state") || r.state === params.get("state")) &&
        (!params.get("q") ||
          `${r.name} ${r.cpid} ${r.document}`
            .toLowerCase()
            .includes(params.get("q")!.toLowerCase())),
    );
}
export async function exportReport(viewer: Employee, params: URLSearchParams) {
  const rows=await reportRows(viewer,params),format=params.get("format")==="pdf"?"pdf":"xlsx";
  const bytes=await brandedBytes("Detalle de obligaciones",["CPID","Empleado","Sede","Documento","Fecha límite","Estado"],rows.map(r=>[r.cpid,r.name,r.site,r.document,r.dueDate,r.state]),format,JSON.stringify(Object.fromEntries(params)));
  return new Response(new Uint8Array(bytes),{headers:{"Content-Type":format==="pdf"?"application/pdf":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="upkeephr-obligaciones.${format}"`,"Cache-Control":"private, no-store"}});
}
