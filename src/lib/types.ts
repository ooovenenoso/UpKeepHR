export interface Person {
  accountId?: string;
  id: string;
  cpid: string;
  name: string;
  lastNames?: string;
  email?: string;
  role: string;
  site: string;
  position: string;
  hireDate?: string;
  active: boolean;
  source: string;
  supervisorId?: string | null;
  legacyData?: string | null;
}
export interface Policy {
  id: string;
  version: number;
  expiryMode: string;
  validityMonths: number | null;
  initialDays: number;
  calendarMode: string;
  reviewMonths: number | null;
  reviewCount: number | null;
  reviewTargetId: string | null;
  reminders: number[];
  overdueDays: number;
  sites: string[];
  positions: string[];
}
export interface DocType {
  id: string;
  code: string;
  name: string;
  description: string;
  instructions: string;
  active: boolean;
  autoAssign: boolean;
  rule: Policy;
}
export interface FileInfo {
  id: string;
  filename: string;
  mime: string;
  size: number;
}
export interface Delivery {
  assignedReviewerId?: string | null;
  id: string;
  status: string;
  issueDate?: string | null;
  expiresDate?: string | null;
  receivedDate: string;
  submittedAt?: string;
  reason?: string | null;
  origin?: string;
  files?: FileInfo[];
}
export interface ReportRow {
  id: string;
  employeeId: string;
  name: string;
  cpid: string;
  site: string;
  position: string;
  document: string;
  documentTypeId: string;
  kind: string;
  reviewIndex: number | null;
  dueDate: string;
  fulfilledDate: string | null;
  days: number;
  state: string;
  cycleId: string | null;
  source: string;
  origin: string | null;
  submissions: Delivery[];
}
export interface MailItem {
  id: string;
  kind: string;
  subject: string;
  text: string;
  recipients: string[];
  createdAt: string;
  status: string;
  error: string | null;
  attempts: number;
}
export interface BatchSummary {
  id: string;
  filename: string;
  status: string;
  createdAt: string;
}
export interface ImportRowView {
  id: string;
  rowNumber: number;
  payload: {
    cpid: string;
    name: string;
    lastNames: string;
    email: string;
    site: string;
    position: string;
    hireDate: string;
    warnings: string[];
  };
  issues: string[];
  status: string;
}
export interface ImportView extends BatchSummary {
  rows: ImportRowView[];
}
export interface RulePreview {
  ruleId: string;
  version: number;
  digest: string;
  changes: {
    id: string;
    employee: string;
    cpid: string;
    kind: string;
    oldDate: string;
    newDate: string;
    revision: number;
  }[];
}
export interface AppState {
  storageProvider: string;
  dashboard: Awaited<ReturnType<typeof import("./dashboard").dashboardData>>;
  queue: Record<string, number>;
  user: Person;
  employees: Person[];
  documents: DocType[];
  obligations: ReportRow[];
  notifications: MailItem[];
  imports: BatchSummary[];
  settings: {
    heartbeat?: { finishedAt: string; error: string | null; provider: string };
    lastBackup?: { date: string; createdAt: string; path: string };
  };
  audits: {
    id: string;
    action: string;
    entityId: string;
    createdAt: string;
    detail: string;
  }[];
  today: string;
  localMode: boolean;
  emailProvider: string;
}
