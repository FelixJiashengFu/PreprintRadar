import { join } from "node:path";
import { LOG_DIR } from "./config.ts";

const LOG_FILE = join(LOG_DIR, "app.log");
const MAX_BYTES = 2_000_000;
let writes = 0;

function fmt(part: unknown): string {
  if (typeof part === "string") return part;
  if (part instanceof Error) return part.stack ?? part.message;
  return Deno.inspect(part, { depth: 4, colors: false });
}

/** Log to the console (when there is one) and to %LOCALAPPDATA%\PreprintRadar\logs\app.log. */
export function log(...parts: unknown[]) {
  const line = `${new Date().toISOString()} ${parts.map(fmt).join(" ")}`;
  try {
    console.log(line);
  } catch {
    // --no-terminal builds have no console
  }
  try {
    Deno.mkdirSync(LOG_DIR, { recursive: true });
    if (writes++ % 500 === 0) {
      try {
        if (Deno.statSync(LOG_FILE).size > MAX_BYTES) Deno.renameSync(LOG_FILE, LOG_FILE + ".1");
      } catch { /* no log yet */ }
    }
    Deno.writeTextFileSync(LOG_FILE, line + "\n", { append: true });
  } catch { /* logging must never break the app */ }
}

export const LOG_PATH = LOG_FILE;
