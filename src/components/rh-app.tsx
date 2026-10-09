"use client";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import {
  ShieldCheck,
  LayoutDashboard,
  Users,
  Files,
  ClipboardCheck,
  BarChart3,
  Bell,
  Upload,
  Plus,
  ArrowUpRight,
  ChevronRight,
  Search,
  LogOut,
  Check,
  Clock,
  TriangleAlert,
  FileText,
  MoreHorizontal,
  ArrowLeft,
  X,
  LoaderCircle,
  Activity,
  CalendarDays,
  CheckCircle2,
} from "lucide-react";
import {LawCycleCard} from "./law-overview";
import {matchesCurrent,employeeCompliance} from "@/lib/filtering";
import {complianceSummary} from "@/lib/compliance-metrics";
import {AccountSecurity} from "./account-security";
import {AccessScreen,OfficialBrand} from "./access-screen";
import {UserPanel,DashboardOverview,ReportsPanel,ReviewAssignment,BulkAssignments,SavedFilters,directUpload} from "./cloud-panels";
import type {
  AppState,
  Person,
  DocType,
  ReportRow,
  Delivery,
  MailItem,
  RulePreview,
} from "@/lib/types";

const labels: Record<string, string> = {
  POR_VERIFICAR: "Por verificar",
  ACTIVO: "Activo",
  INACTIVO: "Inactivo",
  SIN_REQUISITOS: "Sin requisitos asignados",
  CUMPLIDA: "Entrega cumplida",
  CANCELADA: "Cancelada",
  EN_REVISION: "En revisión",
  VENCIDA: "Vencida",
  VENCE_HOY: "Vence hoy",
  URGENTE: "Urgente",
  POR_VENCER: "Por vencer",
  PENDIENTE: "Pendiente",
  PENDING: "En revisión",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  PREVIEW: "Simulado",
  ACCEPTED: "Aceptado por proveedor",
  DELIVERED: "Entregado",
  FAILED: "Error de envío",
  UNCERTAIN: "Por comprobar",
  BOUNCED: "Rebotado",
  SENDING: "Procesando",
  CANCELLED: "Omitido",
  QUEUED: "En cola",
  SUPERADMIN: "Superadmin",
  DISABLED: "Correo deshabilitado",
  VIGENTE: "Vigente",
  REVISION_VENCIDA: "Revisión vencida",
  RH: "Recursos Humanos",
  SUPERVISOR: "Supervisora",
  EMPLOYEE: "Empleado",
  INITIAL: "Entrega inicial",
  RENEWAL: "Renovación",
  REVIEW: "Revisión periódica",
};
const date = (v?: string | null) =>
  v ? `${v.slice(5, 7)}/${v.slice(8, 10)}/${v.slice(0, 4)}` : "—";
const initials = (name: string) =>
  name
    .split(/[ ,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
const number = (f: FormData, k: string) => Number(f.get(k));
const strings = (f: FormData, k: string) =>
  String(f.get(k) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const form = body instanceof FormData;
  const result = await fetch(`/api/${path}`, {
    method,
    headers:
      method === "GET"
        ? {}
        : {
            "x-rh-request": "1",
            ...(form ? {} : { "Content-Type": "application/json" }),
          },
    body:
      method === "GET" ? undefined : form ? body : JSON.stringify(body ?? {}),
  });
  const data = await result.json();
  if (!result.ok)
    throw new Error(data.error ?? "No se pudo completar la operación.");
  return data;
}
function Badge({ state }: { state: string }) {
  return (
    <span className={`badge state-${state.toLowerCase()}`}>
      <span />
      {labels[state] ?? state}
    </span>
  );
}
function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  return (
    <span className={`avatar ${large ? "large" : ""}`}>{initials(name)}</span>
  );
}
function Empty({
  title = "Todo al día",
  description = "No hay registros en esta vista.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="empty">
      <CheckCircle2 />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar">
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Field({
  label,
  name,
  type = "text",
  value,
  required = false,
  children,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string | number | null;
  required?: boolean;
  children?: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children ?? (
        <input
          name={name}
          type={type}
          defaultValue={value ?? ""}
          required={required}
        />
      )}{" "}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function FormActions({
  busy,
  onClose,
  label = "Guardar cambios",
}: {
  busy: boolean;
  onClose: () => void;
  label?: string;
}) {
  return (
    <div className="form-actions">
      <button type="button" className="secondary" onClick={onClose}>
        Cancelar
      </button>
      <button className="primary" disabled={busy}>
        {busy ? <LoaderCircle className="spin" /> : <Check />}
        {label}
      </button>
    </div>
  );
}

export function LocalMailbox() {
  const [items, setItems] = useState<MailItem[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const refresh = () =>
      api<MailItem[]>("dev/mailbox")
        .then(setItems)
        .catch((e) => setError(e.message));
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, []);
  return (
    <main className="mailbox">
      <a href="/" className="back-link">
        <ArrowLeft />
        Volver al portal
      </a>
      <div className="eyebrow">ENTORNO LOCAL</div>
      <h1>Bandeja de pruebas</h1>
      <p>
        Estos mensajes están simulados. Los códigos de acceso caducan a los diez
        minutos.
      </p>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {!items.length && (
        <Empty
          title="Esperando mensajes"
          description="Solicite un código de acceso o espere un aviso del motor."
        />
      )}
      {items.map((m) => (
        <article className="mail-card" key={m.id}>
          <div className="mail-top">
            <Badge state={m.status === "PENDING" ? "QUEUED" : m.status} />
            <time>{new Date(m.createdAt).toLocaleString("es-PR")}</time>
          </div>
          <h2>{m.subject}</h2>
          <p className="muted">Para: {m.recipients.join(", ")}</p>
          <pre>{m.text}</pre>
        </article>
      ))}
    </main>
  );
}
const navigation = [
  ["dashboard", "Resumen", LayoutDashboard],
  ["employees", "Empleados", Users],
  ["users", "Usuarios y acceso", ShieldCheck],
  ["documents", "Documentos", Files],
  ["review", "Entregas", ClipboardCheck],
  ["reports", "Reportes", BarChart3],
  ["notifications", "Notificaciones", Bell],
  ["security", "Mi seguridad", ShieldCheck],
] as const;
const titles: Record<string, [string, string]> = {
  dashboard: [
    "Resumen de cumplimiento",
    "La documentación de tu equipo, en un solo lugar.",
  ],
  employees: [
    "Nuestro equipo",
    "Expedientes, sedes y requisitos de cada empleado.",
  ],
  documents: [
    "Documentos requeridos",
    "Configura vigencias, revisiones y avisos para cada requisito.",
  ],
  review: [
    "Entregas por revisar",
    "Confirma documentos y fechas para actualizar el cumplimiento.",
  ],
  reports: [
    "Reportes de cumplimiento",
    "Explora el detalle y exporta los resultados que necesitas.",
  ],
  notifications: [
    "Notificaciones y actividad",
    "Avisos automáticos, estado del motor y trazabilidad.",
  ],
security: ["Mi seguridad", "Contraseña y autenticadora de tu cuenta."],
  users: ["Usuarios y acceso", "Administra cuentas, roles y activaciones seguras."],
  personal: ["Mis documentos", "Tus entregas, próximos plazos e historial."],
};
type DialogState = {
  type: string;
  person?: Person;
  document?: DocType;
  row?: ReportRow;
  delivery?: Delivery;
  mail?: MailItem;
  preview?: RulePreview;
};
export function RHApp() {
  const [state, setState] = useState<AppState | null>(null),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState("dashboard"),
    [dialog, setDialog] = useState<DialogState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [filters, setFilters] = useState<Record<string, string>>({});
  const refreshNumber=useRef(0);
  const refresh = useCallback(
    () => {
      const requestNumber=++refreshNumber.current;
      return (
      api<AppState>("state")
        .then((s) => {
          if(requestNumber!==refreshNumber.current)return;
          setState(s);
          setLoading(false);
        })
        .catch((e) => {
          if(requestNumber!==refreshNumber.current)return;
          if (e.message.includes("sesión") || e.message.includes("autenticadora")) setState(null);
          else setError(e.message);
          setLoading(false);
        }));
    },
    [],
  );
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function action(
    work: () => Promise<unknown>,
    message = "Cambio guardado.",
    close = true,
  ) {
    setBusy(true);
    setError("");
    try {
      await work();
      setNotice(message);
      if (close) setDialog(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="loading">
        <ShieldCheck />
        <span>Preparando tu portal…</span>
      </div>
    );
  if (!state)
    return (
      <AccessScreen
        onLogin={() => {
          setLoading(true);
          void refresh();
        }}
      />
    );
  const rh = ["RH", "SUPERADMIN"].includes(state.user.role),
    supervisor = state.user.role === "SUPERVISOR",
    activeTab = !rh && !supervisor && !["notifications","security"].includes(tab) ? "personal" : tab;
  const heading = titles[activeTab];
  const selectedRows = state.obligations.filter(
    (r) =>
      (!query ||
        `${r.name} ${r.cpid} ${r.document}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      Object.entries(filters).every(
        ([k, v]) =>
          !v ||
          (k === "supervisor"
            ? state.employees.find((e) => e.id === r.employeeId)
                ?.supervisorId === v
            : String(r[k as keyof ReportRow]) === v),
      ),
  );
  const pending = state.obligations
    .filter((r) => r.state === "EN_REVISION")
    .flatMap((r) =>
      r.submissions
        .filter((s) => s.status === "PENDING")
        .map((s) => ({ row: r, delivery: s })),
    );
  const open = selectedRows.filter(
    (r) => !["CUMPLIDA", "CANCELADA"].includes(r.state),
  );
  const current = state.dashboard.rows.filter(r=>matchesCurrent(r,filters,query));
  const currentSummary=complianceSummary(current);
  const dossierRequirements=state.dashboard.rows.filter(r=>r.employeeId===dialog?.person?.id);
  const dossierObligations=state.obligations.filter(r=>r.employeeId===dialog?.person?.id);
  const dossierPending=dossierObligations.filter(r=>!["CUMPLIDA","CANCELADA"].includes(r.state));
  const dossierHistory=dossierObligations.filter(r=>["CUMPLIDA","CANCELADA"].includes(r.state));
  const dossierCurrentCount=dossierRequirements.filter(r=>r.compliant).length;
  const chartTotal = Math.max(1,current.length);
  const ratio = current.filter(r=>r.compliant).length/chartTotal*100;
  const pendingRatio = current.filter(r=>!r.compliant&&!r.overdue&&!r.pendingReview).length/chartTotal*100;
  const overdueRatio = current.filter(r=>r.overdue).length/chartTotal*100;
  const close = () => {
    setDialog(null);
    setError("");
  };
  const filterBar = (
    <div className="filter-bar">
      <div className="search-field">
        <Search />
        <input
          aria-label="Buscar empleado o documento"
          placeholder="Buscar por nombre, CPID o documento…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {[
        [
          "site",
          "Todas las sedes",
          [...new Set(state.employees.map((e) => e.site))].map((v) => [v, v]),
        ],
        [
          "position",
          "Todos los puestos",
          [...new Set(state.employees.map((e) => e.position))].map((v) => [
            v,
            v,
          ]),
        ],
        [
          "documentTypeId",
          "Todos los documentos",
          state.documents.map((d) => [d.id, d.name]),
        ],
        [
          "state",
          "Todos los estados",
          Object.entries(labels).filter(([k]) =>
            [
              "VIGENTE",
              "POR_VERIFICAR",
              "CUMPLIDA",
              "CANCELADA",
              "EN_REVISION",
              "VENCIDA",
              "VENCE_HOY",
              "URGENTE",
              "POR_VENCER",
              "PENDIENTE",
            ].includes(k),
          ),
        ],
        [
          "supervisor",
          "Todas las supervisoras",
          state.employees
            .filter((e) => e.role === "SUPERVISOR")
            .map((e) => [e.id, e.name]),
        ],
        [
          "source",
          "Todos los datos",
          [
            ["DEMO", "Demostración"],
            ["IMPORT", "Importados"],
            ["MANUAL", "Registrados por RH"],
          ],
        ],
      ].map(([key, label, options]) => (
        <select
          key={key as string}
          aria-label={label as string}
          value={filters[key as string] ?? ""}
          onChange={(e) =>
            setFilters({ ...filters, [key as string]: e.target.value })
          }
        >
          <option value="">{label as string}</option>
          {(options as string[][]).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
  const table = (rows: ReportRow[], personal = false, dossier = false) => (
    <div className="table-wrap" tabIndex={dossier?0:undefined} role={dossier?"region":undefined} aria-label={dossier?"Tabla de entregas, desplazable":undefined}>
      {dossier&&<p className="dossier-scroll-hint">Desliza la tabla para ver el estado y las acciones.</p>}
      <table>
        <thead>
          <tr>
            {!personal && <th>Empleado</th>}
            <th>{dossier?"Entrega requerida":"Documento"}</th>
            <th>{dossier?"Fecha límite de entrega":"Fecha límite"}</th>
            <th>{dossier?"Estado de la entrega":"Estado"}</th>
            <th aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {!personal && (
                <td>
                  <div className="person-cell">
                    <Avatar name={r.name} />
                    <div>
                      <strong>{r.name}</strong>
                      <small>
                        {r.cpid} · {r.site}
                      </small>
                    </div>
                  </div>
                </td>
              )}
              <td>
                <strong>{r.document}</strong>
                <small>
                  {r.reviewIndex
                    ? `Revisión ${r.reviewIndex} de su ciclo`
                    : labels[r.kind]}
                </small>
              </td>
              <td>
                <strong>{date(r.dueDate)}</strong>
                <small>
                  {r.state === "CUMPLIDA"
                    ? r.fulfilledDate
                      ? `Entregado ${date(r.fulfilledDate)}`
                      : "Histórico sin fecha de entrega"
                    : r.days < 0
                      ? `${Math.abs(r.days)} días vencida`
                      : r.days === 0
                        ? "Hoy"
                        : `En ${r.days} días`}
                </small>
              </td>
              <td>
                <Badge state={r.state} />
              </td>
              <td className="row-actions">
                {(rh || r.employeeId === state.user.id) &&
                  !["CUMPLIDA", "CANCELADA", "EN_REVISION"].includes(
                    r.state,
                  ) && (
                    <button
                      className="small-button"
                      onClick={() => setDialog({ type: "upload", row: r })}
                    >
                      Entregar <Upload />
                    </button>
                  )}
                <button
                  className="icon-button"
                  aria-label={`Ver ${r.document} de ${r.name}`}
                  onClick={() => setDialog({ type: "history", row: r })}
                >
                  <ChevronRight />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <Empty
          title="Sin registros"
          description="Prueba con otros filtros o asigna un documento."
        />
      )}
    </div>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <OfficialBrand compact/>
        <div className="side-label">ESPACIO DE TRABAJO</div>
        <nav>
          {navigation
            .filter(
              ([id]) =>
                rh ||
                (supervisor
                  ? ["dashboard", "employees", "reports", "notifications", "security"].includes(id)
                  : ["dashboard", "notifications", "security"].includes(id)),
            )
            .map(([id, name, Icon]) => (
              <button
                key={id}
                className={
                  activeTab === id ||
                  (activeTab === "personal" && id === "dashboard")
                    ? "active"
                    : ""
                }
                onClick={() => {
                  setTab(id);
                }}
              >
                <Icon />
                <span>
                  {!rh && !supervisor && id === "dashboard"
                    ? "Mis documentos"
                    : name}
                </span>
                {id === "review" && pending.length > 0 && (
                  <b>{pending.length}</b>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-footer">
          <div className="workspace-card">
            <Activity />
            <div>
              <strong>{state.localMode ? "Desarrollo" : "Producción · UpKeepHR"}</strong>
              <span>Correos deshabilitados</span>
            </div>
            <span className="local-dot" />
          </div>
          <div className="side-user">
            <Avatar name={state.user.name} />
            <div>
              <strong>{state.user.name.split(" · ")[0]}</strong>
              <span>{labels[state.user.role]}</span>
            </div>
            <button
              aria-label="Cerrar sesión"
              className="icon-button"
              onClick={() =>
                void action(async () => {
                  await api("auth/sign-out", "POST");
                  setState(null);
                }, "Sesión cerrada.")
              }
            >
              <LogOut />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Recursos Humanos <ChevronRight />
            <strong>Documentación</strong>
          </span>
          <div>
            <span className="environment-tag">
              <span className="local-dot" />
              {state.localMode ? "DESARROLLO" : "PRODUCCIÓN"}
            </span>
            <button
              className="icon-button"
              aria-label="Ver notificaciones"
              onClick={() => (rh ? setTab("notifications") : setTab("reports"))}
            >
              <Bell />
            </button>
            <Avatar name={state.user.name} />
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">DOCUMENTACIÓN Y CUMPLIMIENTO</div>
              <h1>{heading[0]}</h1>
              <p>{heading[1]}</p>
            </div>
            <div className="heading-action">
              {activeTab === "employees" && rh ? (
                <button
                  className="primary"
                  onClick={() => setDialog({ type: "employee" })}
                >
                  <Plus />
                  Nuevo empleado
                </button>
              ) : activeTab === "documents" && rh ? (
                <button
                  className="primary"
                  onClick={() => setDialog({ type: "document" })}
                >
                  <Plus />
                  Nuevo documento
                </button>
              ) : (
                <span className="today">
                  <CalendarDays />
                  {date(state.today)} <small>Puerto Rico</small>
                </span>
              )}
            </div>
          </div>
          {error && !dialog && (
            <div role="alert" className="error dismissible">
              {error}
              <button onClick={() => setError("")} aria-label="Cerrar error">
                <X />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="notice dismissible">
              <CheckCircle2 />
              {notice}
              <button onClick={() => setNotice("")} aria-label="Cerrar mensaje">
                <X />
              </button>
            </div>
          )}
          {activeTab === "dashboard" && (
            <>
              {filterBar}
              <SavedFilters filters={filters} query={query} onSelect={(f,q)=>{setFilters(f);setQuery(q);}}/>
              <DashboardOverview state={state} filters={filters} query={query}/>
              <div className="metrics">
                <Metric
                  title="Empleados activos"
                  value={new Set(current.map(r=>r.employeeId)).size}
                  subtitle="En tu alcance de consulta"
                  icon={<Users />}
                />
                <Metric
                  title="Al día según registros"
                  value={currentSummary.percent===null?"Sin datos":`${currentSummary.percent}%`}
                  subtitle={`${currentSummary.compliant}/${currentSummary.requirements} · incluye el historial importado`}
                  icon={<ShieldCheck />}
                />
                <Metric
                  title="Documentos por vencer"
                  value={currentSummary.approachingExpiry}
                  subtitle="Dentro de los próximos 30 días"
                  icon={<Clock />}
                  tone="amber"
                />
                <Metric
                  title="Certificados vencidos"
                  value={currentSummary.expiredCertificates}
                  subtitle={`${currentSummary.overdueReviews} verificaciones atrasadas${currentSummary.initialOverdue?` · ${currentSummary.initialOverdue} plazos iniciales vencidos`:""}`}
                  icon={<TriangleAlert />}
                  tone="red"
                />
              </div>
              <div className="dashboard-grid">
                <section className="panel agenda">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        Agenda de vencimientos{" "}
                        <span className="count">
                          {current.filter(r=>r.overdue||(r.days!==null&&r.days<=30)).length}
                        </span>
                      </h2>
                      <p>Primero lo que necesita atención.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setTab("reports")}
                    >
                      Ver todo <ArrowUpRight />
                    </button>
                  </div>
                  <div className="table-wrap"><table><thead><tr><th>Empleado</th><th>Documento</th><th>Fecha límite</th><th>Estado</th><th/></tr></thead><tbody>{current.filter(r=>r.overdue||(r.days!==null&&r.days<=30)).sort((a,b)=>(a.dueDate??"").localeCompare(b.dueDate??"")).slice(0,7).map(r=><tr key={r.id}><td>{r.name}</td><td>{r.document}<small>{r.law?.nextAction}</small></td><td>{date(r.dueDate)}{r.law&&!r.law.verified&&<small>Ciclo estimado</small>}</td><td><Badge state={r.state}/></td><td><button className="small-button" onClick={()=>setDialog({type:"person",person:state.employees.find(e=>e.id===r.employeeId)})}>Expediente</button></td></tr>)}</tbody></table></div>
                </section>
                <section className="panel status-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Estado del expediente</h2>
                      <p>Estado actual según fechas y revisiones registradas.</p>
                    </div>
                    <Files />
                  </div>
                  <div
                    className="donut"
                    style={{
                      background: `conic-gradient(#208c71 0 ${ratio}%, #d88939 ${ratio}% ${ratio + pendingRatio}%, #dd6960 ${ratio + pendingRatio}% ${ratio + pendingRatio + overdueRatio}%, #70a1b8 ${ratio + pendingRatio + overdueRatio}% 100%)`,
                    }}
                  >
                    <div>
                      <strong>
                        {
                          current.length
                        }
                      </strong>
                      <span>requisitos</span>
                    </div>
                  </div>
                  <div className="legend">
                    {[
                      [
                        "green",
                        "Al día",
                        current.filter(r=>r.compliant).length,
                      ],
                      [
                        "amber",
                        "Pendientes",
                        current.filter(r=>!r.compliant&&!r.overdue&&!r.pendingReview).length,
                      ],
                      [
                        "red",
                        "Vencidos / plazos atrasados",
                        current.filter(r=>r.overdue).length,
                      ],
                      [
                        "blue",
                        "En revisión",
                        current.filter(r=>!r.compliant&&!r.overdue&&r.pendingReview).length,
                      ],
                    ].map(([color, label, value]) => (
                      <div key={color}>
                        <span>
                          <i className={color as string} />
                          {label}
                        </span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="panel-note">
                    <ShieldCheck />
                    El cumplimiento considera vencimientos y revisiones. Los registros históricos sin anexo digital cuentan; una entrega nueva requiere revisión de RH.
                  </div>
                </section>
                <section className="panel review-summary">
                  <div className="summary-icon">
                    <ClipboardCheck />
                  </div>
                  <div>
                    <h2>
                      {currentSummary.pending
                        ? `${currentSummary.pending} entrega(s) esperan revisión`
                        : "Sin entregas pendientes en esta vista"}
                    </h2>
                    <p>
                      {currentSummary.pending
                        ? "Los recordatorios al empleado están pausados durante la revisión."
                        : "Los empleados pueden subir documentos desde su portal."}
                    </p>
                  </div>
                  {rh && (
                    <button
                      className="secondary"
                      onClick={() => setTab("review")}
                    >
                      Revisar entregas <ArrowUpRight />
                    </button>
                  )}
                </section>
              </div>
            </>
          )}
          {activeTab === "personal" && (
            <>
              <div className="personal-banner">
                <Avatar name={state.user.name} large />
                <div>
                  <h2>Hola, {state.user.name.split(" ")[0]}</h2>
                  <p>
                    {open.length} obligación(es) pendientes · {state.user.site}
                  </p>
                </div>
                <ShieldCheck />
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Lo que necesitas entregar</h2>
                    <p>Sube una copia legible y RH confirmará su recepción.</p>
                  </div>
                </div>
                {table(open, true)}
              </section>
              <section className="panel history-section">
                <div className="panel-heading">
                  <h2>Tu historial</h2>
                </div>
                {table(
                  state.obligations.filter((r) =>
                    ["CUMPLIDA", "CANCELADA"].includes(r.state),
                  ),
                  true,
                )}
              </section>
            </>
          )}
          {activeTab === "employees" && (
            <section className="panel">
              {filterBar}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Sede / puesto</th>
                      <th>Acceso</th>
                      <th>Situación laboral</th>
                      <th>Cumplimiento actual</th>
                      <th>Ley 300</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {state.employees
                      .filter(
                        (e) =>
                          (!query ||
                            `${e.name} ${e.cpid}`
                              .toLowerCase()
                              .includes(query.toLowerCase())) &&
                          Object.entries(filters).every(
                            ([k, v]) =>
                              !v ||
                              (k==="state"&&!filters.documentTypeId&&["VIGENTE","CUMPLIDA","VENCIDA","POR_VERIFICAR","EN_REVISION","PENDIENTE"].includes(v)
                                ? employeeCompliance(state.dashboard.rows.filter(r=>r.employeeId===e.id),e.active)===(v==="CUMPLIDA"?"VIGENTE":v)
                                : ["documentTypeId", "state"].includes(k)
                                ? current.some(
                                    (r) => r.employeeId === e.id,
                                  )
                                : k === "supervisor"
                                  ? e.supervisorId === v
                                  : String(e[k as keyof Person]) === v),
                          ),
                      )
                      .map((e) => {
                        const requirements=state.dashboard.rows.filter(r=>r.employeeId===e.id),expired=requirements.filter(r=>r.overdue).length;
                        const law=requirements.find(r=>r.law)?.law??null;
                        const status=employeeCompliance(requirements,e.active);
                        return (
                        <tr key={e.id}>
                          <td>
                            <div className="person-cell">
                              <Avatar name={e.name} />
                              <div>
                                <strong>{e.name}</strong>
                                <small>
                                  {e.cpid}
                                  {e.source === "DEMO" ? " · Demostración" : ""}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <strong>{e.site}</strong>
                            <small>{e.position}</small>
                          </td>
                          <td>{labels[e.role]}</td>
                          <td>
                            <Badge
                              state={e.active ? "ACTIVO" : "INACTIVO"}
                            />
                          </td>
                          <td><Badge state={status}/><small>{expired} vencidos o revisiones atrasadas · {requirements.filter(r=>r.compliant).length}/{requirements.length} al día</small></td>
                          <td>{law?law.year?`Año ${law.year} de 5${law.verified?"":" · estimado"}`:"Sin determinar":"Sin asignación"}<small>{law?.verified?"Verificado":"Emisión por verificar"}</small></td>
                          <td className="row-actions">
                            <button
                              className="small-button"
                              onClick={() =>
                                setDialog({ type: "person", person: e })
                              }
                            >
                              Expediente <ChevronRight />
                            </button>
                            {rh && (
                              <button
                                aria-label={`Editar ${e.name}`}
                                className="icon-button"
                                onClick={() =>
                                  setDialog({ type: "employee", person: e })
                                }
                              >
                                <MoreHorizontal />
                              </button>
                            )}
                          </td>
                        </tr>
                      );})}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {activeTab === "documents" && (
            <div className="document-grid">
              {state.documents.map((d) => (
                <article className="document-card" key={d.id}>
                  <div className="doc-top">
                    <span className="doc-icon">
                      <FileText />
                    </span>
                    <span className="version">VERSIÓN {d.rule.version}</span>
                  </div>
                  <h2>{d.name}</h2>
                  <p>{d.description}</p>
                  <div className="doc-facts">
                    <span>
                      <Clock />
                      {d.rule.expiryMode === "NONE"
                        ? "Sin vencimiento"
                        : d.rule.expiryMode === "PROVIDED"
                          ? "Fecha del certificado"
                          : `${d.rule.validityMonths} meses de vigencia`}
                    </span>
                    {d.rule.reviewMonths && (
                      <span>
                        <CalendarDays />
                        Revisión cada {d.rule.reviewMonths} meses
                        {d.rule.reviewCount
                          ? ` · ${d.rule.reviewCount} entregas`
                          : ""}
                      </span>
                    )}
                    <span>
                      <Bell />
                      Avisos: {d.rule.reminders.join(", ")} días
                    </span>
                    <span>
                      <Users />
                      {d.autoAssign
                        ? "Asignación automática"
                        : "Asignación por RH o ciclo"}
                    </span>
                  </div>
                  <div className="doc-actions">
                    <button
                      className="secondary"
                      onClick={() =>
                        setDialog({ type: "document", document: d })
                      }
                    >
                      Editar reglas
                    </button>
                    <button
                      className="text-button"
                      onClick={() =>
                        void action(
                          async () => {
                            const preview = await api<RulePreview>(
                              `rules/${d.id}/preview`,
                            );
                            setDialog({ type: "apply", document: d, preview });
                          },
                          "Vista previa preparada.",
                          false,
                        )
                      }
                    >
                      Aplicar a existentes <ArrowUpRight />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {activeTab === "review" && (
            <div className="review-grid">
              {pending.length ? (
                pending.map(({ row, delivery }) => (
                  <article className="review-card" key={delivery.id}>
                    <div className="person-cell">
                      <Avatar name={row.name} />
                      <div>
                        <strong>{row.name}</strong>
                        <small>
                          {row.cpid} · {row.site}
                        </small>
                      </div>
                      <Badge state="EN_REVISION" />
                    </div>
                    <h2>{row.document}</h2>
                    <p>
                      {row.reviewIndex
                        ? `Revisión ${row.reviewIndex}`
                        : labels[row.kind]}{" "}
                      · entregado {date(delivery.receivedDate)}
                    </p>
                    <div className="file-chips">
                      {delivery.files?.map((f) => (
                        <a
                          href={`/api/files/${f.id}`}
                          key={f.id}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FileText />
                          {f.filename}
                          <ArrowUpRight />
                        </a>
                      ))}
                    </div>
                    <ReviewAssignment delivery={delivery} onChange={()=>void refresh()}/>
                    <button
                      className="primary full"
                      onClick={() =>
                        setDialog({ type: "review", row, delivery })
                      }
                    >
                      Revisar entrega <ChevronRight />
                    </button>
                  </article>
                ))
              ) : (
                <section className="panel">
                  <Empty
                    title="No hay entregas pendientes"
                    description="Las próximas entregas aparecerán aquí automáticamente."
                  />
                </section>
              )}
            </div>
          )}
          {activeTab === "security" && <AccountSecurity onChange={()=>void refresh()}/>}
          {activeTab === "users" && rh && <UserPanel state={state} onChange={()=>void refresh()}/>}
          {activeTab === "employees" && rh && <BulkAssignments state={state} onChange={()=>void refresh()}/>}
          {activeTab === "reports" && <>{filterBar}<SavedFilters filters={filters} query={query} onSelect={(f,q)=>{setFilters(f);setQuery(q);}}/><ReportsPanel state={state} filters={filters} query={query}/></>}
          {activeTab === "notifications" && (
            <>
              {rh && <section className="motor-panel">
                <span className="summary-icon">
                  <Activity />
                </span>
                <div>
                  <h2>Motor de automatización</h2>
                  <p>
                    Revisa cada minuto · recordatorios de 08:00 a 18:00 · Puerto
                    Rico
                  </p>
                  <small>
                    Última ejecución:{" "}
                    {state.settings.heartbeat
                      ? new Date(
                          state.settings.heartbeat.finishedAt,
                        ).toLocaleString("es-PR")
                      : "Esperando el primer ciclo"}
                    {state.settings.heartbeat?.error &&
                      ` · Error: ${state.settings.heartbeat.error}`}
                    {` · Cola: ${(state.queue.PENDING ?? 0) + (state.queue.SENDING ?? 0)} · Errores: ${(state.queue.FAILED ?? 0) + (state.queue.UNCERTAIN ?? 0) + (state.queue.BOUNCED ?? 0)}`}
                  </small>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () => api("motor/tick", "POST"),
                      "Motor procesado. Los avisos respetan su horario.",
                    )
                  }
                >
                  Procesar ahora
                </button>
              </section>}
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Historial de notificaciones</h2>
                    <p>
                      Proveedor actual:{" "}
                      {state.emailProvider === "preview"
                        ? "vista previa local"
                        : "deshabilitado"}
                      . Ningún mensaje simulado se envía.
                    </p>
                  </div>
                  {state.localMode && state.emailProvider === "preview" && <a
                    className="text-button"
                    href="/bandeja-local"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Bandeja local <ArrowUpRight />
                  </a>}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Mensaje</th>
                        <th>Destinatario</th>
                        <th>Fecha</th>
                        <th>Resultado</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {state.notifications.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <strong>{m.subject}</strong>
                            <small>
                              {m.kind} · {m.attempts} intento(s)
                            </small>
                          </td>
                          <td>{m.recipients.join(", ")}</td>
                          <td>
                            {new Date(m.createdAt).toLocaleString("es-PR")}
                          </td>
                          <td>
                            <Badge state={m.status} />
                            {m.error && (
                              <small className="red-text">{m.error}</small>
                            )}
                          </td>
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`Ver mensaje ${m.subject}`}
                              onClick={() =>
                                setDialog({ type: "mail", mail: m })
                              }
                            >
                              <ChevronRight />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!state.notifications.length && (
                    <Empty
                      title="Sin avisos todavía"
                      description="El motor los generará cuando corresponda."
                    />
                  )}
                </div>
              </section>
              {rh && <section className="panel history-section">
                <div className="panel-heading">
                  <div>
                    <h2>Respaldo y auditoría</h2>
                    <p>
                      Último respaldo:{" "}
                      {state.settings.lastBackup
                        ? new Date(
                            state.settings.lastBackup.createdAt,
                          ).toLocaleString("es-PR")
                        : "Pendiente"}
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () => api("backups", "POST"),
                        "Respaldo preparado. El motor continuará copiando los archivos pendientes.",
                      )
                    }
                  >
                    Crear respaldo
                  </button>
                </div>
                <div className="audit-list">
                  {state.audits.slice(0, 15).map((a) => (
                    <div key={a.id}>
                      <span>
                        <CheckCircle2 />
                        {a.action.replaceAll("_", " ").toLowerCase()}
                      </span>
                      <time>
                        {new Date(a.createdAt).toLocaleString("es-PR")}
                      </time>
                    </div>
                  ))}
                </div>
              </section>}
            </>
          )}
          <footer className="page-footer">
            <span>UpKeepHR · Documentación RH</span>
            <span>
              {state.localMode ? "Entorno de pruebas" : "Supabase · datos de producción"} <span className="local-dot" />
            </span>
          </footer>
        </main>
      </div>
      {dialog && (
        <Modal
          title={
            {
              employee: dialog.person ? "Editar empleado" : "Nuevo empleado",
              document: dialog.document
                ? "Nueva versión de reglas"
                : "Nuevo documento",
              upload: "Entregar documentación",
              review: "Revisar entrega",
              history: "Historial del documento",
              person: "Expediente del empleado",
              assign: "Asignar documento",
              verifyLaw: "Verificar emisión original Ley 300",
              apply: "Aplicar nueva regla",
              mail: "Vista previa de notificación",
              due: "Ajustar fecha límite",
            }[dialog.type] ?? "Detalle"
          }
          onClose={close}
          wide={["person", "apply", "document"].includes(dialog.type)}
        >
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {dialog.type === "employee" && (
            <EmployeeForm
              person={dialog.person}
              state={state}
              busy={busy}
              onClose={close}
              onSubmit={(f) =>
                void action(
                  () =>
                    api(
                      dialog.person
                        ? `employees/${dialog.person.id}`
                        : "employees",
                      dialog.person ? "PATCH" : "POST",
                      {
                        ...Object.fromEntries(f),
                        active: f.get("active") === "true",
                        supervisorId: String(f.get("supervisorId")) || null,
                      },
                    ),
                  "Empleado guardado.",
                )
              }
            />
          )}
          {dialog.type === "document" && (
            <DocumentForm
              document={dialog.document}
              state={state}
              busy={busy}
              onClose={close}
              onSubmit={(data) =>
                void action(
                  () =>
                    api(
                      dialog.document
                        ? `documents/${dialog.document.id}`
                        : "documents",
                      dialog.document ? "PATCH" : "POST",
                      data,
                    ),
                  "Regla guardada. Las obligaciones existentes mantienen su versión.",
                )
              }
            />
          )}
          {dialog.type === "upload" && (
            <UploadForm
              row={dialog.row!}
              doc={state.documents.find(
                (d) => d.id === dialog.row!.documentTypeId,
              )!}
              busy={busy}
              onClose={close}
              onSubmit={(f) =>
                void action(
                  async () => state.storageProvider === "supabase" ? api("submissions/complete", "POST", {uploadId: await directUpload(f.getAll("files") as File[], "DOCUMENT", String(f.get("obligationId"))), issueDate: f.get("issueDate") || null, expiresDate: f.get("expiresDate") || null}) : api("submissions", "POST", f),
                  "Entrega recibida. RH revisará el archivo y sus fechas.",
                )
              }
            />
          )}
          {dialog.type === "review" && (
            <ReviewForm
              row={dialog.row!}
              delivery={dialog.delivery!}
              requiresInitialBackground={dialog.row!.kind!=="REVIEW"&&state.documents.some(d=>d.id===dialog.row!.documentTypeId&&d.code==="LEY300")}
              busy={busy}
              onClose={close}
              onSubmit={(data) =>
                void action(
                  () =>
                    api(
                      `submissions/${dialog.delivery!.id}/review`,
                      "POST",
                      data,
                    ),
                  "Revisión registrada.",
                )
              }
            />
          )}
          {dialog.type === "history" && (
            <div className="modal-body">
              <h3>{dialog.row!.document}</h3>
              <p>
                {dialog.row!.name} · {labels[dialog.row!.kind]} ·{" "}
                {date(dialog.row!.dueDate)}
              </p>
              <Badge state={dialog.row!.state} />
              <div className="timeline">
                {dialog.row!.submissions.map((s) => (
                  <div key={s.id}>
                    <Badge state={s.status} />
                    <p>
                      Entrega: {date(s.receivedDate)}{" "}
                      {s.origin === "LEGACY_NO_FILE"
                        ? "· Histórico sin archivo"
                        : ""}
                    </p>
                    {s.reason && <p>{s.reason}</p>}
                    {(rh || dialog.row!.employeeId === state.user.id) && <a className="small-button" href={`/api/submissions/${s.id}/receipt`}>Descargar comprobante PDF</a>}
                    <div className="file-chips">
                      {s.files?.map((f) => (
                        <a
                          key={f.id}
                          href={`/api/files/${f.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FileText />
                          {f.filename}
                          <ArrowUpRight />
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {!dialog.row!.submissions.length && (
                <p className="muted">
                  {dialog.row!.origin === "IMPORT"
                    ? "Datos históricos migrados sin archivo adjunto."
                    : "Todavía no hay archivos entregados para esta obligación."}
                </p>
              )}
              {rh && !["CUMPLIDA", "CANCELADA"].includes(dialog.row!.state) && (
                <button
                  className="secondary"
                  onClick={() => setDialog({ ...dialog, type: "due" })}
                >
                  <CalendarDays />
                  Ajustar plazo
                </button>
              )}
            </div>
          )}
          {dialog.type === "person" && (
            <div className="modal-body">
              <div className="person-profile">
                <Avatar name={dialog.person!.name} large />
                <div>
                  <h2>{dialog.person!.name}</h2>
                  <p>
                    {dialog.person!.cpid} · {dialog.person!.site} ·{" "}
                    {dialog.person!.position}
                  </p>
                </div>
              </div>
              {rh && (
                <div className="button-group">
                  <button
                    className="primary"
                    onClick={() => setDialog({ ...dialog, type: "assign" })}
                  >
                    <Plus />
                    Asignar documento
                  </button>
                  {dialog.person!.source === "IMPORT" && (
                    <button
                      className="secondary"
                      onClick={() =>
                        setDialog({ ...dialog, type: "verifyLaw" })
                      }
                    >
                      <ShieldCheck />
                      Verificar Ley 300
                    </button>
                  )}
                </div>
              )}
              <section className="dossier-section dossier-current" aria-labelledby="dossier-current-title">
                <div className="dossier-section-head">
                  <span className="dossier-section-icon"><ShieldCheck aria-hidden="true"/></span>
                  <div><span className="dossier-kicker">SITUACIÓN HOY</span><h3 id="dossier-current-title">Estado actual de los documentos</h3></div>
                  <span className="dossier-count">{dossierRequirements.length} {dossierRequirements.length===1?"documento":"documentos"}</span>
                </div>
                <p className="dossier-explanation">Consulta si cada requisito está al día según sus fechas y verificaciones registradas.</p>
                <div className="dossier-summary"><span><CheckCircle2 aria-hidden="true"/>{dossierCurrentCount} al día</span><span><ClipboardCheck aria-hidden="true"/>{dossierRequirements.length-dossierCurrentCount} {dossierRequirements.length-dossierCurrentCount===1?"requiere atención":"requieren atención"}</span></div>
                {dossierRequirements.length?<div className="table-wrap"><table><thead><tr><th scope="col">Documento requerido</th><th scope="col">Cumplimiento actual</th><th scope="col">Vence el certificado</th><th scope="col">Próximo paso</th><th scope="col">Anexos digitales</th></tr></thead><tbody>{dossierRequirements.map(r=>{
                  const nextTask=dossierPending.find(o=>o.documentTypeId===r.documentTypeId&&o.dueDate===r.dueDate);
                  return <tr key={r.id}><td data-label="Documento requerido"><strong>{r.document}</strong><small>{r.recordBasis==="IMPORTED_RECORD"?"Registro histórico importado":r.recordBasis==="APPROVED"?"Aprobación en plataforma":"Sin entrega registrada"}</small></td><td data-label="Cumplimiento actual"><Badge state={r.state}/></td><td data-label="Vence el certificado">{date(r.expiresDate)}</td><td data-label="Próximo paso">{date(r.dueDate)}{(r.dueDate||r.law)&&<small>{r.law?.nextAction??(nextTask?labels[nextTask.kind]:"Próxima entrega")}</small>}</td><td data-label="Anexos digitales">{r.attachmentCount} {r.attachmentCount===1?"archivo":"archivos"}</td></tr>;
                })}</tbody></table></div>:<p className="dossier-empty">Este expediente no tiene requisitos activos.</p>}
              </section>
              <section className="dossier-section dossier-tasks" aria-labelledby="dossier-tasks-title">
                <div className="dossier-section-head">
                  <span className="dossier-section-icon"><CalendarDays aria-hidden="true"/></span>
                  <div><span className="dossier-kicker">PRÓXIMAS ENTREGAS</span><h3 id="dossier-tasks-title">Entregas pendientes y renovaciones</h3></div>
                  <span className="dossier-count">{dossierPending.length} {dossierPending.length===1?"tarea":"tareas"}</span>
                </div>
                <p className="dossier-explanation">Aquí puedes entregar, corregir o renovar documentación. Una renovación pendiente puede corresponder a un certificado que todavía está vigente.</p>
                {dossierPending.length?table(dossierPending,true,true):<p className="dossier-empty">No hay entregas pendientes ni renovaciones programadas.</p>}
              </section>
              <details className="dossier-history">
                <summary><Clock aria-hidden="true"/><span>Historial de entregas y períodos cerrados</span><span className="dossier-count">{dossierHistory.length} {dossierHistory.length===1?"registro":"registros"}</span><ChevronRight className="dossier-history-chevron" aria-hidden="true"/></summary>
                <div className="dossier-history-body"><p className="dossier-explanation">Una entrega cumplida registra ese período. La vigencia de hoy se consulta en «Estado actual de los documentos».</p>{dossierHistory.length?table(dossierHistory,true,true):<p className="dossier-empty">Todavía no hay entregas cumplidas ni períodos cerrados.</p>}</div>
              </details>
              <LawCycleCard law={dossierRequirements.find(r=>r.law)?.law??null}/>
            </div>
          )}
          {dialog.type === "assign" && (
            <form
              className="modal-body"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(
                  () =>
                    api("assignments", "POST", {
                      employeeId: dialog.person!.id,
                      documentTypeId: String(f.get("documentTypeId")),
                      ...(f.get("dueDate")
                        ? { dueDate: String(f.get("dueDate")) }
                        : {}),
                    }),
                  "Documento asignado.",
                );
              }}
            >
              <p>{dialog.person!.name}</p>
              <Field label="Documento requerido" name="documentTypeId">
                <select name="documentTypeId">
                  {state.documents
                    .filter((d) => d.active)
                    .map((d) => (
                      <option value={d.id} key={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field
                label="Fecha límite (opcional)"
                name="dueDate"
                type="date"
                hint="En blanco: se aplica el plazo de la regla."
              />
              <FormActions
                busy={busy}
                onClose={close}
                label="Asignar documento"
              />
            </form>
          )}
          {dialog.type === "verifyLaw" && (
            <form
              className="modal-body"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(
                  () =>
                    api(`employees/${dialog.person!.id}/verify-law`, "POST", {
                      issueDate: String(f.get("issueDate")),
                      confirmLegacy: f.get("confirmLegacy") === "on",
                    }),
                  "Emisión verificada y ciclo generado.",
                );
              }}
            >
              <p>
                Coteja la fecha de emisión ORIGINAL con el certificado de{" "}
                {dialog.person!.name}. No la deduzcas del vencimiento.
              </p>
              <Field
                label="Emisión original verificada"
                name="issueDate"
                type="date"
                required
              />
              <label className="check-field">
                <input type="checkbox" name="confirmLegacy" />
                También confirmé la primera verificación junto a Ley 300 y las revisiones posteriores
                registradas en la hoja.
              </label>
              <p className="muted">
                Se conservarán como entregas históricas sin archivo adjunto. La
                primera entrega cuenta como antecedentes del año 1 junto al documento base.
              </p>
              <FormActions
                busy={busy}
                onClose={close}
                label="Confirmar emisión"
              />
            </form>
          )}
          {dialog.type === "apply" && (
            <div className="modal-body">
              <p>
                Versión {dialog.preview!.version} de {dialog.document!.name}.
                Las entregas aprobadas se conservarán. Las entregas en revisión
                deben resolverse antes de recalcular.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Actual</th>
                      <th>Nuevo plazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dialog.preview!.changes.map((c) => (
                      <tr key={c.id}>
                        <td>
                          {c.employee}
                          <small>{labels[c.kind]}</small>
                        </td>
                        <td>{date(c.oldDate)}</td>
                        <td>{c.newDate ? date(c.newDate) : "Se cancela"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-actions">
                <button className="secondary" onClick={close}>
                  Cancelar
                </button>
                <button
                  className="primary"
                  disabled={busy || !dialog.preview!.changes.length}
                  onClick={() =>
                    void action(
                      () =>
                        api(`rules/${dialog.document!.id}/apply`, "POST", {
                          digest: dialog.preview!.digest,
                        }),
                      "Regla aplicada con historial conservado.",
                    )
                  }
                >
                  Aplicar cambios
                </button>
              </div>
            </div>
          )}
          {dialog.type === "mail" && (
            <div className="modal-body">
              <Badge state={dialog.mail!.status} />
              <h3>{dialog.mail!.subject}</h3>
              <p className="muted">
                Para: {dialog.mail!.recipients.join(", ")}
              </p>
              <pre className="mail-content">{dialog.mail!.text}</pre>
              {dialog.mail!.error && (
                <div className="error">{dialog.mail!.error}</div>
              )}
            </div>
          )}
          {dialog.type === "due" && (
            <form
              className="modal-body"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void action(
                  () =>
                    api(
                      `obligations/${dialog.row!.id}/due`,
                      "PATCH",
                      Object.fromEntries(f),
                    ),
                  "Plazo ajustado y cambio auditado.",
                );
              }}
            >
              <p>
                {dialog.row!.name} · {dialog.row!.document}
              </p>
              <Field
                label="Nueva fecha límite"
                name="dueDate"
                type="date"
                value={dialog.row!.dueDate}
                required
              />
              <Field label="Motivo del cambio" name="reason" required />
              <FormActions busy={busy} onClose={close} />
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
function Metric({
  title,
  value,
  subtitle,
  icon,
  tone = "green",
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <article className={`metric metric-${tone}`}>
      <div>
        <span>{title}</span>
        <span className="metric-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <p>{subtitle}</p>
    </article>
  );
}
function EmployeeForm({
  person,
  state,
  busy,
  onClose,
  onSubmit,
}: {
  person?: Person;
  state: AppState;
  busy: boolean;
  onClose: () => void;
  onSubmit: (f: FormData) => void;
}) {
  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        f.set("active", f.get("active") === "on" ? "true" : "false");
        onSubmit(f);
      }}
    >
      <div className="form-grid">
        <Field label="CPID" name="cpid" value={person?.cpid} required />
        <Field
          label="Nombre completo"
          name="name"
          value={person?.name}
          required
        />
        <Field
          label="Apellidos"
          name="lastNames"
          value={person?.lastNames}
          required
        />
        <Field
          label="Correo registrado"
          name="email"
          type="email"
          value={person?.email}
          required
        />
        <Field label="Sede" name="site" value={person?.site} required />
        <Field
          label="Puesto"
          name="position"
          value={person?.position}
          required
        />
        <Field
          label="Fecha de ingreso"
          name="hireDate"
          type="date"
          value={person?.hireDate ?? state.today}
          required
        />
        <Field label="Acceso" name="role">
          <select name="role" defaultValue={person?.role ?? "EMPLOYEE"}>
            {(state.user.role === "SUPERADMIN" ? ["EMPLOYEE", "SUPERVISOR", "RH"] : ["EMPLOYEE", "SUPERVISOR"]).map((r) => (
              <option value={r} key={r}>
                {labels[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supervisora" name="supervisorId">
          <select name="supervisorId" defaultValue={person?.supervisorId ?? ""}>
            <option value="">Sin asignar</option>
            {state.employees
              .filter(
                (e) =>
                  ["SUPERVISOR", "RH"].includes(e.role) &&
                  e.id !== person?.id &&
                  e.active,
              )
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <label className="check-field">
        <input
          type="checkbox"
          name="active"
          defaultChecked={person?.active ?? true}
        />
        Empleado activo
      </label>
      <p className="muted">
        Al desactivar se cancelan pendientes y se conserva todo el historial.
      </p>
      <FormActions busy={busy} onClose={onClose} />
    </form>
  );
}
function DocumentForm({
  document,
  state,
  busy,
  onClose,
  onSubmit,
}: {
  document?: DocType;
  state: AppState;
  busy: boolean;
  onClose: () => void;
  onSubmit: (data: unknown) => void;
}) {
  const [mode, setMode] = useState(document?.rule.expiryMode ?? "PROVIDED");
  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          review = number(f, "reviewMonths") || null;
        onSubmit({
          name: String(f.get("name")),
          description: String(f.get("description")),
          instructions: String(f.get("instructions")),
          autoAssign: f.get("autoAssign") === "on",
          expiryMode: mode,
          validityMonths: number(f, "validityMonths") || null,
          initialDays: number(f, "initialDays"),
          calendarMode: String(f.get("calendarMode")),
          reviewMonths: review,
          reviewCount: review ? number(f, "reviewCount") || null : null,
          reviewTargetId: review
            ? String(f.get("reviewTargetId")) || null
            : null,
          reminders: strings(f, "reminders").map(Number),
          overdueDays: number(f, "overdueDays"),
          sites: strings(f, "sites"),
          positions: strings(f, "positions"),
        });
      }}
    >
      <div className="form-grid">
        <Field
          label="Nombre del documento"
          name="name"
          value={document?.name}
          required
        />
        <Field
          label="Plazo inicial (días)"
          name="initialDays"
          type="number"
          value={document?.rule.initialDays ?? 30}
          required
        />
        <Field
          label="Descripción"
          name="description"
          value={document?.description ?? ""}
        />
        <Field label="Instrucciones para entregar" name="instructions">
          <textarea
            name="instructions"
            defaultValue={
              document?.instructions ??
              "Adjunte una copia legible del certificado completo."
            }
          />
        </Field>
        <Field label="Vencimiento" name="expiryMode">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="PROVIDED">Fecha indicada en certificado</option>
            <option value="FROM_ISSUE">Calculado desde emisión</option>
            <option value="NONE">Sin vencimiento</option>
          </select>
        </Field>
        <Field
          label="Vigencia (meses)"
          name="validityMonths"
          type="number"
          value={document?.rule.validityMonths}
          required={mode === "FROM_ISSUE"}
        />
        <Field label="Calendario" name="calendarMode">
          <select
            name="calendarMode"
            defaultValue={document?.rule.calendarMode ?? "CLAMP"}
          >
            <option value="CLAMP">Último día del mes si no existe</option>
            <option value="ANNIVERSARY">
              Aniversario anual · 29 febrero pasa a 1 marzo
            </option>
          </select>
        </Field>
        <Field
          label="Avisos antes de vencer (días)"
          name="reminders"
          value={document?.rule.reminders.join(", ") ?? "10, 5, 0"}
          required
          hint="Separados por coma. Cero corresponde al día límite."
        />
        <Field
          label="Repetir después de vencer (días)"
          name="overdueDays"
          type="number"
          value={document?.rule.overdueDays ?? 7}
          hint="Cero desactiva recordatorios posteriores."
        />
        <Field
          label="Revisar cada (meses)"
          name="reviewMonths"
          type="number"
          value={document?.rule.reviewMonths}
          hint="En blanco: sin revisiones periódicas."
        />
        <Field
          label={document?.code==="LEY300"?"Verificaciones totales, incluida la inicial":"Número de revisiones"}
          name="reviewCount"
          type="number"
          value={document?.rule.reviewCount}
          hint={document?.code==="LEY300"?"4 = la primera junto a Ley 300 y 3 posteriores (años 2, 3 y 4). La renovación conserva la vigencia configurada.":"En blanco: periódicas mientras siga vigente."}
        />
        <Field label="Documento exigido en revisión" name="reviewTargetId">
          <select
            name="reviewTargetId"
            defaultValue={document?.rule.reviewTargetId ?? ""}
          >
            <option value="">Sin revisión</option>
            <option value="SELF">Este mismo documento</option>
            {state.documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Aplicar a sedes"
          name="sites"
          value={document?.rule.sites.join(", ")}
          hint="Separadas por coma. En blanco: todas."
        />
        <Field
          label="Aplicar a puestos"
          name="positions"
          value={document?.rule.positions.join(", ")}
          hint="Separados por coma. En blanco: todos."
        />
      </div>
      <label className="check-field">
        <input
          name="autoAssign"
          type="checkbox"
          defaultChecked={document?.autoAssign ?? true}
        />
        Asignar automáticamente cuando el empleado cumpla las condiciones
      </label>
      <p className="muted">
        Los cambios crean una versión. Los ciclos existentes se actualizan
        únicamente con una vista previa y aplicación explícita.
      </p>
      <FormActions busy={busy} onClose={onClose} label="Guardar versión" />
    </form>
  );
}
function UploadForm({
  row,
  doc,
  busy,
  onClose,
  onSubmit,
}: {
  row: ReportRow;
  doc: DocType;
  busy: boolean;
  onClose: () => void;
  onSubmit: (f: FormData) => void;
}) {
  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        f.set("obligationId", row.id);
        onSubmit(f);
      }}
    >
      <h3>{row.document}</h3>
      <p>
        {row.reviewIndex ? `Revisión ${row.reviewIndex}` : labels[row.kind]} ·
        fecha límite {date(row.dueDate)}
      </p>
      <div className="instructions">{doc.instructions}</div>
      {doc.code==="LEY300"&&row.kind!=="REVIEW"&&<p className="notice">Entrega Ley 300 junto con los antecedentes penales: esta es la primera verificación del ciclo. Puedes adjuntar ambos en un PDF o en archivos separados. Las tres verificaciones posteriores corresponden a antecedentes de los años 2, 3 y 4.</p>}
      <div className="form-grid">
        <Field
          label="Fecha de emisión"
          name="issueDate"
          type="date"
          required={
            doc.rule.expiryMode === "FROM_ISSUE" || row.kind === "REVIEW"
          }
        />
        <Field
          label="Fecha de vencimiento"
          name="expiresDate"
          type="date"
          required={doc.rule.expiryMode === "PROVIDED" && row.kind !== "REVIEW"}
        />
      </div>
      <label className="file-drop">
        <Upload />
        <strong>Adjunta tus documentos</strong>
        <span>PDF, JPG o PNG · máximo 5 archivos de 10 MB</span>
        <input
          name="files"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          multiple
          required
        />
      </label>
      <p className="muted">
        La entrega quedará en revisión. RH confirmará la validez de los
        documentos.
      </p>
      <FormActions busy={busy} onClose={onClose} label="Entregar documentos" />
    </form>
  );
}
function ReviewForm({
  row,
  delivery,
  requiresInitialBackground,
  busy,
  onClose,
  onSubmit,
}: {
  row: ReportRow;
  delivery: Delivery;
  requiresInitialBackground: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (data: unknown) => void;
}) {
  const [backgroundConfirmed,setBackgroundConfirmed]=useState(false);
  return (
    <form
      className="modal-body"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget),
          submitter = (e.nativeEvent as SubmitEvent)
            .submitter as HTMLButtonElement;
        onSubmit({
          approve: submitter.value === "approve",
          issueDate: String(f.get("issueDate")) || null,
          expiresDate: String(f.get("expiresDate")) || null,
          reason: String(f.get("reason")),
          initialBackgroundConfirmed: f.get("initialBackgroundConfirmed")==="on",
        });
      }}
    >
      <h3>{row.document}</h3>
      <p>
        {row.name} ·{" "}
        {row.reviewIndex ? `Revisión ${row.reviewIndex}` : labels[row.kind]}
      </p>
      <div className="file-chips">
        {delivery.files?.map((f) => (
          <a
            key={f.id}
            href={`/api/files/${f.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <FileText />
            {f.filename}
            <ArrowUpRight />
          </a>
        ))}
      </div>
      <div className="form-grid">
        <Field
          label="Emisión verificada"
          name="issueDate"
          type="date"
          value={delivery.issueDate}
        />
        <Field
          label="Vencimiento verificado"
          name="expiresDate"
          type="date"
          value={delivery.expiresDate}
        />
      </div>
      <Field label="Motivo si se rechaza" name="reason">
        <textarea
          name="reason"
          placeholder="Explica qué debe corregir el empleado."
        />
      </Field>
      {requiresInitialBackground&&<label className="check-field"><input type="checkbox" name="initialBackgroundConfirmed" checked={backgroundConfirmed} onChange={e=>setBackgroundConfirmed(e.target.checked)}/>Confirmé Ley 300 y los antecedentes penales de la primera verificación en esta entrega.</label>}
      <p className="muted">
        Aprobar satisface esta obligación. Una renovación completa inicia un
        nuevo ciclo.
      </p>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>
          Cancelar
        </button>
        <button className="danger" value="reject" disabled={busy}>
          Rechazar
        </button>
        <button className="primary" value="approve" disabled={busy||(requiresInitialBackground&&!backgroundConfirmed)}>
          <Check />
          Aprobar entrega
        </button>
      </div>
    </form>
  );
}
