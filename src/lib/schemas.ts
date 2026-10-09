import { z } from "zod";
import { validDate, normalizeCpid } from "./domain";
const date = z.string().refine(validDate, "Fecha inválida: use AAAA-MM-DD.");
export const employeeInput = z.object({
  cpid: z.string().trim().min(1).max(64).transform(normalizeCpid),
  name: z.string().trim().min(3).max(160),
  lastNames: z.string().trim().min(2).max(100),
  email: z.email(),
  role: z.enum(["RH", "EMPLOYEE", "SUPERVISOR"]).default("EMPLOYEE"),
  site: z.string().trim().min(1).max(80),
  position: z.string().trim().min(1).max(100),
  hireDate: date,
  supervisorId: z.string().nullable().optional(),
  active: z.boolean().default(true),
});
export const documentInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().max(1500),
    instructions: z.string().max(3000),
    autoAssign: z.boolean().default(true),
    expiryMode: z.enum(["NONE", "PROVIDED", "FROM_ISSUE"]),
    validityMonths: z.number().int().min(1).max(1200).nullable(),
    initialDays: z.number().int().min(0).max(3650),
    calendarMode: z.enum(["CLAMP", "ANNIVERSARY"]).default("CLAMP"),
    reviewMonths: z.number().int().min(1).max(1200).nullable(),
    reviewCount: z.number().int().min(1).max(100).nullable(),
    reviewTargetId: z.string().nullable(),
    reminders: z
      .array(z.number().int().min(0).max(365))
      .min(1)
      .max(12)
      .transform((a) => [...new Set([...a, 0])].sort((a, b) => b - a)),
    overdueDays: z.number().int().min(0).max(365),
    sites: z.array(z.string().max(80)).max(100),
    positions: z.array(z.string().max(100)).max(100),
  })
  .superRefine((r, c) => {
    if (r.expiryMode === "FROM_ISSUE" && !r.validityMonths)
      c.addIssue({
        code: "custom",
        message: "Indique la duración de vigencia.",
      });
    if (r.reviewMonths && !r.reviewTargetId)
      c.addIssue({
        code: "custom",
        message: "Seleccione el documento de revisión.",
      });
    if (!r.reviewMonths && (r.reviewCount || r.reviewTargetId))
      c.addIssue({
        code: "custom",
        message: "Configure el intervalo de revisión.",
      });
  });
export type DocumentInput = z.infer<typeof documentInput>;
