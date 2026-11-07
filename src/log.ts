export type Level = 'info' | 'warn' | 'error';

/** One JSON line per log entry. Never pass secrets in `details`. */
export function log(level: Level, message: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, message, ...details }));
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
