/** Minimal structured (JSON lines) logger; no external dependency needed. */
type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = (process.env.LOG_LEVEL as Level | undefined) ?? "info";

function write(level: Level, scope: string, message: string, fields?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, scope, message, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function getLogger(scope: string) {
  return {
    debug: (message: string, fields?: Record<string, unknown>) => write("debug", scope, message, fields),
    info: (message: string, fields?: Record<string, unknown>) => write("info", scope, message, fields),
    warn: (message: string, fields?: Record<string, unknown>) => write("warn", scope, message, fields),
    error: (message: string, fields?: Record<string, unknown>) => write("error", scope, message, fields),
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
