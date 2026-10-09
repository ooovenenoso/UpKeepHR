import fs from "node:fs";
import path from "node:path";
const tokensFile = path.resolve("../.env");
if (fs.existsSync(tokensFile)) process.loadEnvFile(tokensFile);
export const cloudDirectory = path.resolve(process.env.UPKEEPHR_CONFIG_DIR ?? path.join(process.env.LOCALAPPDATA ?? ".", "UpKeepHR", "cloud"));
export type CloudState = Record<string, string>;
export function readCloudState(): CloudState {
  const file = path.join(cloudDirectory, "provision-state.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}
