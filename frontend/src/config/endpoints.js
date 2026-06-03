const N8N_BASE = "https://sohanroytalari.app.n8n.cloud";
const BACKEND_BASE = "http://localhost:3001";

export const ENDPOINTS = {
  // Backend
  startWorkflow: `${BACKEND_BASE}/api/workflow/start`,
  workflowStatus: (id) => `${BACKEND_BASE}/api/workflow/${id}`,
  workflowNext: (id) => `${BACKEND_BASE}/api/workflow/${id}/next`,
  workflowFail: (id) => `${BACKEND_BASE}/api/workflow/${id}/fail`,
  workflowAudit: (id) => `${BACKEND_BASE}/api/workflow/${id}/audit`,
  workflowHealth: (id) => `${BACKEND_BASE}/api/workflow/${id}/health`,
  healthz: `${BACKEND_BASE}/healthz`,
  meetingAnalyze: `${BACKEND_BASE}/api/meeting/analyze`,

  // N8N
  n8nOnboarding: `${N8N_BASE}/webhook-test/autoops-start`,
  n8nMeeting: `${N8N_BASE}/webhook-test/meeting-analyze`,
  n8nFailure: `${N8N_BASE}/webhook-test/handle-failure`,
};

/** WebSocket URL matching BACKEND_BASE host/port */
export const WS_URL = BACKEND_BASE.replace(/^http/, "ws");

export { BACKEND_BASE, N8N_BASE };
