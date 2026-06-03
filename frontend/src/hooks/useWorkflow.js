export { BACKEND_BASE as API_BASE } from "../config/endpoints.js";

/**
 * @param {object | null | undefined} snapshot
 */
export function workflowStatusLabel(snapshot) {
  if (!snapshot) return "loading";
  const rs = snapshot.runStatus;
  if (rs === "completed") return "completed";
  if (rs === "escalated") return "escalated";
  if (rs === "failed") return "failed";
  return "active";
}
