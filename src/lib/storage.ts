import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { filesDir, cloudStorage } from "./config";
import { signedDownload } from "./object-store";
import { assert, localDate, validDate } from "./domain";
import { db } from "./db";
import { audit, isRh } from "./compliance";
import type { Employee } from "../generated/prisma/client";

export function detectMime(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  return null;
}
export async function submitFiles(actor: Employee, form: FormData) {
  assert(!cloudStorage, "Use la carga directa de archivos.", 400);
  const obligationId = String(form.get("obligationId") ?? "");
  const o = await db.obligation.findUniqueOrThrow({
    where: { id: obligationId },
    include: { employee: true },
  });
  assert(
    o.employeeId === actor.id || isRh(actor),
    "No puede entregar por este empleado.",
    403,
  );
  assert(
    o.status === "OPEN" && o.employee.active,
    "Esta obligación ya está cerrada.",
    409,
  );
  const files = form.getAll("files").filter((f) => f instanceof File) as File[];
  assert(
    files.length > 0 && files.length <= 5,
    "Adjunte de uno a cinco archivos.",
  );
  const issueDate = String(form.get("issueDate") ?? "") || null,
    expiresDate = String(form.get("expiresDate") ?? "") || null;
  if (issueDate)
    assert(
      validDate(issueDate) && issueDate <= localDate(),
      "Emisión inválida o futura.",
    );
  if (expiresDate) assert(validDate(expiresDate), "Vencimiento inválido.");
  const stored: {
    filename: string;
    storageKey: string;
    mime: string;
    size: number;
    sha256: string;
  }[] = [];
  try {
    for (const file of files) {
      assert(
        file.size > 0 && file.size <= 10 * 1024 * 1024,
        "Cada archivo debe pesar entre 1 byte y 10 MB.",
      );
      const buffer = Buffer.from(await file.arrayBuffer()),
        mime = detectMime(buffer);
      assert(
        mime && ["application/pdf", "image/jpeg", "image/png"].includes(mime),
        "Formato inválido. Use un PDF, JPG o PNG real.",
      );
      assert(
        !file.type || file.type === mime,
        "El contenido y el formato declarado no coinciden.",
      );
      const storageKey = randomUUID();
      await fs.writeFile(path.join(filesDir, storageKey), buffer, {
        flag: "wx",
      });
      stored.push({
        filename: path.basename(file.name).slice(0, 180),
        storageKey,
        mime,
        size: file.size,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      });
    }
    return await db.$transaction(async (tx) => {
      const current = await tx.obligation.findUniqueOrThrow({
        where: { id: obligationId },
      });
      assert(
        current.status === "OPEN",
        "La obligación se cerró durante la entrega.",
        409,
      );
      assert(
        !(await tx.submission.count({
          where: { obligationId, status: "PENDING" },
        })),
        "Ya existe una entrega en revisión.",
        409,
      );
      const submission = await tx.submission.create({
        data: {
          employeeId: o.employeeId,
          obligationId,
          status: "PENDING",
          issueDate,
          expiresDate,
          receivedDate: localDate(),
          files: { create: stored },
        },
      });
      await audit(tx, actor.id, "SUBMISSION_CREATED", submission.id, {
        obligationId,
        files: stored.map((f) => ({ name: f.filename, size: f.size })),
      });
      return submission;
    });
  } catch (error) {
    for (const f of stored)
      await fs.unlink(path.join(filesDir, f.storageKey)).catch(() => {});
    throw error;
  }
}
export async function readAttachment(actor: Employee, id: string) {
  const file = await db.attachment.findUniqueOrThrow({
    where: { id },
    include: { submission: true },
  });
  assert(
    isRh(actor) || file.submission.employeeId === actor.id,
    "No tiene acceso a este archivo.",
    403,
  );
  if (cloudStorage) return signedDownload("hhrr-documents",file.storageKey,file.filename);
  const bytes = await fs.readFile(path.join(filesDir, file.storageKey));
  return new Response(bytes, {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
