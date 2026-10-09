import { db } from "../src/lib/db";
import { assignApplicable, openCycle } from "../src/lib/compliance";
import { addDays, addMonths, localDate } from "../src/lib/domain";
const specs = [
  ["SALUD", "Certificado de Salud", 12, true],
  ["LEY300", "Ley 300", 60, true],
  ["ANTECEDENTES", "Antecedentes policiales", null, false],
  ["FAMILIA", "Departamento de la Familia", 12, true],
  ["CPR", "CPR", 24, true],
  ["HUELLAS", "Huellas", 60, true],
  ["INOCUIDAD", "Inocuidad", 60, true],
] as const;
for (const [code, name, months, autoAssign] of specs) {
  const type = await db.documentType.upsert({
    where: { code },
    update: {},
    create: {
      code,
      name,
      description: `Requisito de documentación: ${name}.`,
      instructions:
        "Adjunte una copia legible del certificado completo. RH verificará el documento y sus fechas.",
      autoAssign,
    },
  });
  if (!(await db.rule.count({ where: { documentTypeId: type.id } })))
    await db.rule.create({
      data: {
        documentTypeId: type.id,
        version: 1,
        expiryMode: code === "LEY300" ? "FROM_ISSUE" : "PROVIDED",
        validityMonths: months,
        initialDays: 30,
        calendarMode: code === "LEY300" ? "ANNIVERSARY" : "CLAMP",
        reminders: "[10,5,0]",
        overdueDays: 7,
      },
    });
}
const police = await db.documentType.findUniqueOrThrow({
    where: { code: "ANTECEDENTES" },
  }),
  law = await db.documentType.findUniqueOrThrow({ where: { code: "LEY300" } });
const lawRule = await db.rule.findFirstOrThrow({
  where: { documentTypeId: law.id },
  orderBy: { version: "desc" },
});
if (!lawRule.reviewMonths && lawRule.version === 1)
  await db.rule.update({
    where: { id: lawRule.id },
    data: { reviewMonths: 12, reviewCount: 4, reviewTargetId: police.id },
  });
if (
  process.env.DATA_PROFILE === "demo" && process.env.DATABASE_SCHEMA === "hhrr_test" &&
  !(await db.employee.count())
) {
  const today = localDate();
  const rh = await db.employee.create({
    data: {
      cpid: "RH001",
      name: "Elena Rivera · RH",
      lastNames: "Rivera",
      email: "rh@example.test",
      role: "RH",
      site: "OFI. CAGUAS",
      position: "Recursos Humanos",
      hireDate: today,
      source: "DEMO",
    },
  });
  const supervisor = await db.employee.create({
    data: {
      cpid: "SUP001",
      name: "Carolina Torres",
      lastNames: "Torres",
      email: "supervisora@example.test",
      role: "SUPERVISOR",
      site: "CAGUAS",
      position: "Supervisora",
      hireDate: today,
      source: "DEMO",
    },
  });
  for (const [i, name, surname, site] of [
    [1, "María Santiago", "Santiago", "CAGUAS"],
    [2, "José Morales", "Morales", "LOÍZA"],
    [3, "Ana Rodríguez", "Rodríguez", "MONTAÑA"],
    [4, "Luis Pérez", "Pérez", "FIONA"],
  ] as const) {
    const employee = await db.employee.create({
      data: {
        cpid: `EMP00${i}`,
        name,
        lastNames: surname,
        email: `empleado${i}@example.test`,
        role: "EMPLOYEE",
        site,
        position: i === 2 ? "Chofer" : "Maestra",
        hireDate: today,
        source: "DEMO",
        supervisorId: supervisor.id,
      },
    });
    await db.$transaction(async (tx) => {
      await assignApplicable(tx, employee);
      const o = await tx.obligation.findFirstOrThrow({
        where: {
          employeeId: employee.id,
          documentType: { code: "SALUD" },
          kind: "INITIAL",
        },
      });
      // Demonstration dates are relative to first setup and remain persistent.
      const issue = addMonths(today, -12),
        expiry = addDays(
          today,
          i === 1 ? 7 : i === 2 ? -12 : i === 3 ? 23 : 90,
        );
      await openCycle(tx, employee, o, issue, expiry, "DEMO");
      await tx.obligation.update({
        where: { id: o.id },
        data: { status: "FULFILLED", fulfilledDate: today },
      });
    });
  }
  console.log(
    `Datos de demostración creados. RH: ${rh.cpid} / Rivera. Empleado: EMP001 / Santiago. Supervisora: SUP001 / Torres.`,
  );
}
console.log("Catálogo RH listo. El correo permanece deshabilitado según la configuración del entorno.");
await db.$disconnect();
