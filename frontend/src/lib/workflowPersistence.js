/** @type {string} */
export const LS_ACTIVE = "autoops_active_workflow";

/** @type {string} */
export const LS_ALL = "autoops_all_workflows";

const LEGACY_IDS = "autoops-workflow-ids";

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @returns {string[]} */
export function loadAllWorkflowIds() {
  const fromNew = parseJson(localStorage.getItem(LS_ALL));
  if (Array.isArray(fromNew) && fromNew.length > 0) {
    return fromNew.filter((x) => typeof x === "string");
  }
  const legacy = parseJson(localStorage.getItem(LEGACY_IDS));
  if (Array.isArray(legacy) && legacy.length > 0) {
    const ids = legacy.filter((x) => typeof x === "string");
    saveAllWorkflowIds(ids);
    return ids;
  }
  return [];
}

/** @param {string[]} ids */
export function saveAllWorkflowIds(ids) {
  localStorage.setItem(LS_ALL, JSON.stringify([...new Set(ids)]));
}

/** @returns {string | null} */
export function loadActiveWorkflowId() {
  const raw = localStorage.getItem(LS_ACTIVE);
  return raw && raw.length > 0 ? raw : null;
}

/** @param {string | null} id */
export function saveActiveWorkflowId(id) {
  if (id) {
    localStorage.setItem(LS_ACTIVE, id);
  } else {
    localStorage.removeItem(LS_ACTIVE);
  }
}

/** Clears persisted workflow list and active selection (used by Clear All). */
export function clearWorkflowStorage() {
  localStorage.removeItem(LS_ALL);
  localStorage.removeItem(LS_ACTIVE);
  localStorage.removeItem(LEGACY_IDS);
}
