export type Log = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  fields?: Record<string, unknown>
) => void;

/** One JSON line per entry, the shape Cloud Logging parses into structured fields. */
export const log: Log = (level, msg, fields = {}) => {
  console.log(JSON.stringify({ severity: level.toUpperCase(), msg, ...fields }));
};
