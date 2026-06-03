/**
 * In-memory meeting intelligence data for the dashboard.
 * @typedef {Object} MeetingTaskRecord
 * @property {string} id
 * @property {string} batchId
 * @property {string} analyzedAt
 * @property {string} task
 * @property {string} owner
 * @property {string} deadline
 * @property {string} priority
 * @property {string|string[]} dependencies
 */

/** @type {MeetingTaskRecord[]} */
let storedTasks = [];

/** @type {Array<{ id: string, analyzedAt: string, summary: string, totalTasks: number, highPriorityCount: number, source?: string }>} */
const analysisBatches = [];

/**
 * @param {object[]} normalizedTasks
 * @param {{ summary: string, totalTasks: number, highPriorityCount: number, source?: string }} meta
 */
export function persistMeetingAnalysis(normalizedTasks, meta) {
  const batchId = crypto.randomUUID();
  const analyzedAt = new Date().toISOString();

  analysisBatches.push({
    id: batchId,
    analyzedAt,
    summary: meta.summary,
    totalTasks: meta.totalTasks,
    highPriorityCount: meta.highPriorityCount,
    source: meta.source,
  });

  for (const t of normalizedTasks) {
    storedTasks.push({
      id: crypto.randomUUID(),
      batchId,
      analyzedAt,
      ...t,
    });
  }

  return { batchId, analyzedAt };
}

export function getStoredMeetingTasks() {
  return storedTasks.map((t) => ({ ...t }));
}

export function getMeetingAnalysisBatches() {
  return analysisBatches.map((b) => ({ ...b }));
}

/** Test / dev hooks */
export function clearMeetingStore() {
  storedTasks = [];
  analysisBatches.length = 0;
}
