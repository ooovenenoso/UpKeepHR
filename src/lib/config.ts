import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { randomBytes } from "node:crypto";

// The web server, migration CLI and independent worker share the same configuration.
const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.APP_ENV_FILE && fs.existsSync(process.env.APP_ENV_FILE)) process.loadEnvFile(process.env.APP_ENV_FILE);

export const localMode = (process.env.APP_MODE ?? "local") === "local";
export const dataDir = path.resolve(
  /* turbopackIgnore: true */
  process.env.DATA_DIR ??
    path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share"),
      "UpKeepHR",
      process.env.DATA_PROFILE ?? "demo",
    ),
);
export const filesDir = path.join(dataDir, "files");
export const backupDir = path.join(dataDir, "backups");
if (localMode) fs.mkdirSync(filesDir, { recursive: true });
export const databasePath = path.join(dataDir, "rh.sqlite");
export const databaseUrl = process.env.DATABASE_URL ?? "postgresql://unconfigured:unconfigured@localhost:5432/postgres";
export const databaseSchema = process.env.DATABASE_SCHEMA ?? "public";
if (!["public", "hhrr_test"].includes(databaseSchema)) throw new Error("Esquema RH no autorizado.");
export const cloudStorage = process.env.STORAGE_PROVIDER === "supabase";
function getLocalSecret() {
 const secretPath = path.join(dataDir, "auth-secret");
 if (!fs.existsSync(secretPath)) {
  try {
    fs.writeFileSync(secretPath, randomBytes(48).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
 }
 return fs.readFileSync(secretPath, "utf8");
}
export const authSecret = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET ?? (localMode ? getLocalSecret() : "unconfigured-build-secret-not-valid-for-runtime");
export const timezone = "America/Puerto_Rico";
export const emailEnabled = process.env.EMAIL_ENABLED === "true";
export const emailProvider = emailEnabled ? (process.env.EMAIL_PROVIDER ?? "resend") : (localMode && process.env.EMAIL_PROVIDER === "preview" ? "preview" : "disabled");
export const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";
