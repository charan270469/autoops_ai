# AutoOps AI — Build Progress

## Project Structure

List of project files (excluding `node_modules`) with a one-line description of what each does.

| File | Description |
|------|-------------|
| `PROGRESS.md` | This document: build status, architecture notes, and resume instructions. |
| **backend/** | |
| `backend/.env` | Local environment variables (e.g. `GROQ_API_KEY`, optional `GROQ_MODEL`, `AUTOOPS_TRANSIENT_ALL_FAIL`). |
| `backend/.gitignore` | Git ignore rules for the backend package. |
| `backend/agentLogger.js` | Appends structured log lines to workflow step objects during execution. |
| `backend/env-bootstrap.js` | Loads `dotenv` from `backend/.env` before other modules run. |
| `backend/meetingGroq.js` | Groq chat-completions integration for meeting transcript analysis, caching, retries, and JSON task extraction. |
| `backend/meetingStore.js` | In-memory persistence of meeting tasks and analysis batch metadata (used by `/analyze` flow). |
| `backend/mockAgents.js` | Defines the six onboarding step IDs and which mock agent name is assigned to each step. |
| `backend/package.json` | Backend npm manifest: Express, CORS, dotenv, ws, groq-sdk, start/dev scripts. |
| `backend/package-lock.json` | Locked dependency tree for the backend. |
| `backend/routes/meeting.js` | Express router: `POST /analyze`, `POST/GET/PATCH /tasks`, `GET /analysis-store` under `/api/meeting`; optional WebSocket broadcast. |
| `backend/routes/workflow.js` | Express router: workflow start, CRUD, advance, fail, audit, health, n8n plan, retry/reorder/escalate, escalations list under `/api/workflow`. |
| `backend/server.js` | HTTP server on port 3001, CORS, mounts routers, WebSocket server; broadcasts workflow updates and passes `broadcast` into workflow + meeting routers. |
| `backend/steps.md` | Human-readable notes for running/stopping the backend server. |
| `backend/workflowEngine.js` | Core in-memory workflow engine: steps (incl. `retrying` / `escalated` step status), advance, failure/recovery, n8n/Decision/Orchestrator audit types, retry/reorder/escalate helpers, escalation store, health, Groq hooks. |
| `backend/workflowGroqAgents.js` | Groq Decision Agent and Orchestrator Agent (`chat.completions`) for recovery decisions and step hints. |
| **frontend/** | |
| `frontend/dist/*` | Vite production build output (when built). |
| `frontend/index.html` | Dev/prod HTML shell for the Vite React app. |
| `frontend/package.json` | Frontend npm manifest: React 18, Vite 5, Tailwind, lucide-react, dev server on 3000. |
| `frontend/package-lock.json` | Locked dependency tree for the frontend. |
| `frontend/postcss.config.js` | PostCSS config (Tailwind/autoprefixer pipeline). |
| `frontend/src/App.jsx` | Root layout: workflow bootstrap, sidebar (Clear + New), tabs, WebSocket merge, toasts, n8n onboarding hook after **New**, AgentFeed, HealthMonitor, passes props to WorkflowPanel / AuditLog / MeetingIntelligence. |
| `frontend/src/config/endpoints.js` | Single source of truth: `BACKEND_BASE`, `N8N_BASE`, `ENDPOINTS` (REST + n8n webhook URLs), `WS_URL`. |
| `frontend/src/components/AgentFeed.jsx` | Right-rail scrolling feed of recent workflow activity lines. |
| `frontend/src/components/AuditLog.jsx` | Fetches and displays audit trail for the selected workflow ID. |
| `frontend/src/components/HealthMonitor.jsx` | Fetches workflow health for the current workflow (SLA-style summary). |
| `frontend/src/components/MeetingIntelligence.jsx` | Transcript → Groq analysis UI; parallel n8n `meeting-analyze` webhook (ignored on failure). |
| `frontend/src/components/WorkflowPanel.jsx` | Workflow timeline, auto-advance, simulate failure (backend + parallel n8n `handle-failure`), optional n8n plan panel. |
| `frontend/src/hooks/useWebSocket.js` | Connects via `WS_URL` from config, parses JSON messages, exposes connection state. |
| `frontend/src/hooks/useWorkflow.js` | Re-exports `BACKEND_BASE as API_BASE` and `workflowStatusLabel`. |
| `frontend/src/index.css` | Global styles and Tailwind directives. |
| `frontend/src/lib/workflowPersistence.js` | Reads/writes `autoops_active_workflow` and `autoops_all_workflows` (plus legacy key migration). |
| `frontend/src/main.jsx` | React root mount and StrictMode entry. |
| `frontend/tailwind.config.js` | Tailwind theme and content paths. |
| `frontend/vite.config.js` | Vite + React plugin; dev server port 3000, strictPort. |

## Completed Steps

### Phase 1 — Backend (COMPLETE + extensions)

**Core API endpoints**

| Method | Route | Returns / notes |
|--------|--------|-----------------|
| `GET` | `/healthz` | `{ ok: true, service: "autoops-ai-backend" }` |
| `POST` | `/api/workflow/start` | **201** `{ workflowId, workflow }` (public snapshot). |
| `GET` | `/api/workflow/:id` | Public workflow JSON, or **404**. |
| `POST` | `/api/workflow/:id/next` | Public `workflow` on success; **404**/**400** with `{ error }`. |
| `POST` | `/api/workflow/:id/fail` | Body: `failureType` (`transient` \| `dependency` \| `hard`), optional `transientAllRetriesFail`. |
| `GET` | `/api/workflow/:id/audit` | `{ workflowId, events }` or **404**. |
| `GET` | `/api/workflow/:id/health` | Health object or **404**. |

**Additional workflow & n8n ingress endpoints**

| Method | Route | Notes |
|--------|--------|--------|
| `POST` | `/api/workflow/n8n-plan` | Body: `workflowId`, `employeeName`, `department`, `plan` (JSON string). Stores plan in memory, audit `n8n.plan.received`, WebSocket `N8N_PLAN_RECEIVED`. |
| `GET` | `/api/workflow/n8n-plan/:workflowId` | Stored plan or **404**. |
| `POST` | `/api/workflow/retry` | Body: `workflowId`, `stepName`, `action`, `attempts`, `waitSeconds`, `reasoning`, `confidence`. Simulated retry → success. |
| `POST` | `/api/workflow/reorder` | Dependency reorder: skip current pending step, reorder tail per `newOrder`. |
| `POST` | `/api/workflow/escalate` | Hard escalation path + in-memory `escalations[workflowId]`, WebSocket `WORKFLOW_ESCALATED`. |
| `GET` | `/api/workflow/escalations` | `{ escalations: [...], count }`. |

**Meeting routes**

| Method | Route | Notes |
|--------|--------|--------|
| `POST` | `/api/meeting/analyze` | Body: `{ transcript }` — Groq analysis; may persist to `meetingStore` when not cache. |
| `POST` | `/api/meeting/tasks` | n8n task ingestion: `tasks` (string or array), `source`; WebSocket `MEETING_TASKS_RECEIVED`. |
| `GET` | `/api/meeting/tasks` | In-memory `meetingTasks`: `{ tasks, count }` (empty → `{ tasks: [], count: 0 }`). |
| `PATCH` | `/api/meeting/tasks/:taskId` | `{ status: "completed" }` — sets `completedAt`. |
| `GET` | `/api/meeting/analysis-store` | Legacy dashboard: `{ tasks, batches }` from `meetingStore` (Groq `/analyze` history). |

**Self-healing engine — three failure types**

The client sends `failureType`: `transient`, `dependency`, or `hard`. The **Decision Agent** (Groq) returns `RETRY`, `SKIP`, or `ESCALATE` (with fallback). Execution branches: transient retries, dependency skip, hard escalation — as documented previously in this file.

**Groq integration**

- **Default model:** `llama-3.3-70b-versatile` (override with `GROQ_MODEL` in `.env`).
- **Uses Groq:** `workflowGroqAgents.js` (Decision + Orchestrator), `meetingGroq.js` (`/api/meeting/analyze`).

**WebSocket**

- **URL:** `ws://localhost:3001` (same port as HTTP; frontend uses `WS_URL` from `endpoints.js`).
- **Messages:** `{ type: "workflow:update", workflow }` on engine `emit()`; also ad-hoc JSON: `N8N_PLAN_RECEIVED`, `MEETING_TASKS_RECEIVED`, `WORKFLOW_ESCALATED` (and workflow updates) depending on route.

**In-memory data**

- Workflows: `workflowEngine` `Map`; escalations object; optional n8n plan map in `routes/workflow.js`.
- Meeting: `meetingStore` (analyze batches), `meetingTasks` + `meetingAuditTrail` in `routes/meeting.js`.
- `server.js`: WebSocket client list; `broadcast` passed into workflow + meeting routers.

---

### Phase 2 — Frontend (substantially COMPLETE)

#### Step 2.1 — React app & config

- **Central URLs:** `frontend/src/config/endpoints.js` — `BACKEND_BASE`, `N8N_BASE`, `ENDPOINTS` (all REST paths + n8n webhook URLs), `WS_URL`. Update **one file** to change environments.
- **Ports:** Dev **3000** (Vite), API **3001** (`BACKEND_BASE`).

#### Step 2.2 — Workflow panel & sidebar

- **Sidebar:** Workflow list, **Clear** (red, confirmation dialog), **+ New** (cyan). **Clear** clears localStorage, starts one fresh workflow, toast.
- **+ New:** `POST` start workflow, then `POST` n8n onboarding webhook (`ENDPOINTS.n8nOnboarding`) with `{ name, department, employeeId }`; on success stores plan per workflow id, blue toast, plan shown in Workflow panel when selected.
- **WorkflowPanel:** Timeline, auto-advance, simulate failure — **`Promise.all`** backend `/fail` + n8n `handle-failure` (n8n failures ignored); toasts per failure type.
- **Persistence:** `autoops_active_workflow`, `autoops_all_workflows` (see earlier keys).

#### Step 2.3 — Agent Feed and Audit Log (COMPLETE)

- **AgentFeed:** Right-rail feed driven from workflow updates and user actions.
- **AuditLog:** Fetches `ENDPOINTS.workflowAudit(workflowId)` for selected workflow.

#### Step 2.4 — Meeting Intelligence (COMPLETE)

- **Analyze Meeting:** `Promise.all` — Groq `meetingAnalyze` (UI uses this response) + n8n `meeting-analyze` in parallel (failures ignored).

#### Step 2.5 — Health Monitor (COMPLETE)

- **HealthMonitor:** `ENDPOINTS.workflowHealth(workflowId)` in right column (with AgentFeed below).

---

### Phase 3 — n8n Integration (IN PROGRESS / wired)

- **Frontend:** All n8n URLs live in `endpoints.js` (webhook paths may use production or test URLs — adjust `N8N_BASE` / webhook segments as needed).
- **Backend:** Receives plans and tasks via `/api/workflow/n8n-plan` and `/api/meeting/tasks`; emits WebSocket events for the dashboard.

---

### Phase 4 — Final Polish (optional / ongoing)

- UX polish, docs, demos, hackathon presentation.

---

## Pending Items (optional follow-ups)

- Point production deployments at a stable `BACKEND_BASE` / `N8N_BASE` (env-driven config if needed).
- Align n8n webhook paths (`/webhook/...` vs `/webhook-test/...`) with your live n8n instance.

## Current Working State

- Backend: **port 3001**
- Frontend: **port 3000**
- Groq model: **llama-3.3-70b-versatile** (unless `GROQ_MODEL` overrides)
- WebSocket: **working**
- LocalStorage persistence: **working**
- Clear All + New + n8n hooks: **implemented**

## Key Technical Decisions Made

- **Groq** for LLM (no Gemini in this stack).
- **In-memory** backend (no database).
- **Vite + React** frontend.
- **Tailwind CSS** + **lucide-react**.
- **Single `endpoints.js`** for all backend and n8n URLs.

## How To Resume In New Context

1. Read this file first.
2. Backend: `cd backend && npm start` (or `node server.js`).
3. Frontend: `cd frontend && npm run dev`.
4. Adjust `frontend/src/config/endpoints.js` if your n8n URLs or backend host differ.
5. Next optional work: env-based `VITE_*` overrides for `BACKEND_BASE`/`N8N_BASE`, or Phase 4 polish.

## Exact File Contents Summary (logic)

- **`App.jsx`** — Bootstraps workflows from localStorage or creates first workflow; merges WebSocket updates; polls `healthz`; sidebar Clear/New; toasts; n8n plan state per workflow id; tabs Workflow / Meeting / Audit; **HealthMonitor** + **AgentFeed** in right column.
- **`WorkflowPanel.jsx`** — Fetches workflow on selection; auto-advance `/next`; simulate failure with parallel n8n; optional n8n plan banner.
- **`server.js`** — Express + CORS + JSON; `broadcastWs` to all WS clients; `createWorkflowRouter({ broadcast })`, `createMeetingRouter({ broadcast })`; `subscribeWorkflowChange` for `workflow:update` on engine emit.
- **`workflowEngine.js`** — Workflows map, six-step pipeline, Groq recovery, optional `applyWorkflowRetry` / `applyWorkflowReorder` / `applyWorkflowEscalate`, escalations store, audit + emit.
