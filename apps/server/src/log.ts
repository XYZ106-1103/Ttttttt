/** Structured JSON-lines logging (stdout/stderr), easy to ship to any log collector. */
export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(quiet = false): Logger {
  const line = (level: string, msg: string, data?: Record<string, unknown>) =>
    JSON.stringify({ t: new Date().toISOString(), level, msg, ...data });
  return {
    info: (msg, data) => {
      if (!quiet) process.stdout.write(`${line('info', msg, data)}\n`);
    },
    warn: (msg, data) => {
      if (!quiet) process.stderr.write(`${line('warn', msg, data)}\n`);
    },
    error: (msg, data) => process.stderr.write(`${line('error', msg, data)}\n`),
  };
}
