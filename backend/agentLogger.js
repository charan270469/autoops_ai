/**
 * Appends an entry to a step's logs and returns the entry (with timestamp).
 * @param {{ logs: Array<{ at: string, level: string, message: string }> }} step
 * @param {string} message
 * @param {{ level?: string }} [meta]
 */
export function appendStepLog(step, message, meta = {}) {
  const entry = {
    at: new Date().toISOString(),
    level: meta.level ?? "info",
    message,
  };
  step.logs.push(entry);
  return entry;
}
