import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const LOG_DIR = join(REPO_ROOT, "tmp", "logs");
export const LOG_FILE = join(LOG_DIR, "debug.log");

// ensure directory exists at module load time
try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

const val = process.env["PI_MINIONS_DEBUG"];
const enabled = val === "1" || val === "true";

function write(scope: string, msg: string, data?: unknown): void {
  if (!enabled) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const suffix = data !== undefined ? " " + JSON.stringify(data) : "";
  const line = `[${ts}] [${scope}] ${msg}${suffix}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // never throw from a logger
  }
  process.stderr.write(line);
}

export const logger = {
  debug: write,
};
