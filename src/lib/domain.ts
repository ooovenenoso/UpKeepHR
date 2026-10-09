import { timezone } from "./config";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(message, status);
}
export const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
export const normalizeCpid = (value: string) =>
  value
    .trim()
    .replace(/^cpid[\s:\-]*/i, "")
    .toUpperCase();
export function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function localDate(now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export const localHour = (now: Date) =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
export const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000,
  );
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000)
    .toISOString()
    .slice(0, 10);
export function addMonths(date: string, months: number, mode = "CLAMP") {
  const [y, m, d] = date.split("-").map(Number);
  if (mode === "ANNIVERSARY" && months % 12 === 0)
    return new Date(Date.UTC(y + months / 12, m - 1, d))
      .toISOString()
      .slice(0, 10);
  const destination = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(destination.getUTCFullYear(), destination.getUTCMonth() + 1, 0),
  ).getUTCDate();
  destination.setUTCDate(Math.min(d, lastDay));
  return destination.toISOString().slice(0, 10);
}
export function expiryDate(
  rule: {
    expiryMode: string;
    validityMonths: number | null;
    calendarMode: string;
  },
  issue: string | null,
  provided: string | null,
) {
  if (rule.expiryMode === "NONE") return null;
  if (rule.expiryMode === "PROVIDED") {
    assert(
      validDate(provided),
      "Indique la fecha de vencimiento del certificado.",
    );
    return provided;
  }
  assert(
    validDate(issue) && rule.validityMonths,
    "La vigencia calculada requiere emisión y duración.",
  );
  return addMonths(issue, rule.validityMonths, rule.calendarMode);
}
export function currentStage(
  due: string,
  today: string,
  reminders: number[],
  overdue: number,
) {
  const days = daysBetween(due, today);
  if (days < 0 && overdue > 0 && -days >= overdue)
    return `W${Math.floor(-days / overdue)}`;
  if (days <= 0) return "D0";
  const threshold = reminders.filter((d) => d >= days).sort((a, b) => a - b)[0];
  return threshold === undefined ? null : `D${threshold}`;
}
export function stateOf(
  obligation: {
    status: string;
    dueDate: string;
    submissions?: { status: string }[];
  },
  today = localDate(),
) {
  if (obligation.status === "CANCELLED") return "CANCELADA";
  if (obligation.status === "FULFILLED") return "CUMPLIDA";
  if (obligation.submissions?.some((s) => s.status === "PENDING"))
    return "EN_REVISION";
  const days = daysBetween(obligation.dueDate, today);
  return days < 0
    ? "VENCIDA"
    : days === 0
      ? "VENCE_HOY"
      : days <= 10
        ? "URGENTE"
        : days <= 30
          ? "POR_VENCER"
          : "PENDIENTE";
}
export const displayDate = (value?: string | null) =>
  value
    ? `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`
    : "Sin fecha";
export const escapeHtml = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderEmail(title: string, lines: string[]) {
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:24px auto;color:#172c31"><p style="color:#08796a;font-weight:bold">UpKeepHR · RECURSOS HUMANOS</p><h1 style="font-size:24px">${escapeHtml(title)}</h1>${lines.map((l) => `<p style="line-height:1.6">${escapeHtml(l)}</p>`).join("")}<p style="color:#62797b">Consulte su portal de documentación RH.</p></div>`;
}
