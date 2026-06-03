# AutoOps AI 🤖
### Autonomous Multi-Agent Workflow Engine for Enterprise Operations

> *"From static pipelines to intelligent, self-healing enterprise systems"*

Built for **ET GenAI Hackathon 2026 — Phase 2**

---

## 🎯 What is AutoOps AI?

AutoOps AI is a multi-agent system that takes full ownership of complex enterprise workflows. Instead of just executing predefined steps, it **understands context, makes decisions dynamically, detects failures, and recovers automatically** — while keeping a complete auditable trail of every decision it makes.

---

## ✨ Key Features

- **🔄 Autonomous Workflow Execution** — 6-step employee onboarding runs end-to-end with zero human involvement
- **🧠 Multi-Agent Collaboration** — 6 specialized AI agents (Orchestrator, Decision, HR, IT, Finance, Compliance) coordinate in real time
- **🔧 Self-Healing Engine** — 3 distinct recovery strategies: retry transient failures, reorder on dependency failures, escalate hard failures
- **📋 Meeting Intelligence** — Paste any meeting transcript → AI extracts tasks, assigns owners, sets deadlines automatically
- **📊 Predictive SLA Monitoring** — Detects bottlenecks and predicts breaches before they happen
- **🔍 Full Audit Trail** — Every agent decision logged with timestamp, reasoning, and confidence score
- **⚡ Real-Time Dashboard** — Live WebSocket updates across all workflow panels

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **AI / LLM** | Groq · Llama 3.3 70B Versatile |
| **Orchestration** | n8n (3 active workflows) |
| **Backend** | Node.js · Express · WebSocket (ws) |
| **Frontend** | React · Vite · Tailwind CSS · Framer Motion |
| **Icons** | Lucide React |
| **Tunnel** | localhost.run SSH tunnel |

---

## 🏗️ System Architecture

```
INPUT LAYER
├── Employee Onboarding Form (React)
├── Meeting Transcript Input
└── n8n Webhook Triggers
         ↓
ORCHESTRATION LAYER (n8n)
├── AutoOps Onboarding Workflow
├── Meeting Intelligence Workflow
└── Failure Recovery Workflow (3 branches)
         ↓
AI AGENT LAYER (Groq · Llama 3.3 70B)
├── OrchestratorAgent
├── DecisionAgent
├── MeetingIntelligenceAgent
└── MonitorAgent
         ↓
BACKEND ENGINE (Node.js · Express · WebSocket)
├── Workflow State Manager
├── Self-Healing Engine
├── Audit Trail Logger
└── WebSocket Broadcaster
         ↓
REACT DASHBOARD
├── Live Workflow Timeline
├── Agent Activity Feed
├── Audit Log
└── SLA Health Monitor
```

---

## 📁 Project Structure

```
autoops-ai/
├── backend/
│   ├── server.js              # Express server + WebSocket setup
│   ├── workflowEngine.js      # Core workflow state management
│   ├── agentLogger.js         # Audit trail logging
│   ├── mockAgents.js          # Agent simulation layer
│   └── routes/
│       └── workflow.js        # All API route handlers
├── frontend/
│   └── src/
│       ├── App.jsx                        # Root component + state
│       ├── config/
│       │   └── endpoints.js               # All API + n8n URLs
│       ├── components/
│       │   ├── WorkflowPanel.jsx          # Main workflow timeline
│       │   ├── AgentFeed.jsx              # Live agent activity
│       │   ├── AuditLog.jsx               # Decision audit trail
│       │   ├── HealthMonitor.jsx          # SLA health tracking
│       │   └── MeetingIntelligence.jsx    # Transcript analyzer
│       └── hooks/
│           ├── useWebSocket.js            # WebSocket connection
│           └── useWorkflow.js             # Workflow state hook
├── PROGRESS.md                # Full build progress documentation
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Groq API key (free at [console.groq.com](https://console.groq.com))
- n8n account (free at [n8n.io](https://n8n.io))

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/autoops-ai.git
cd autoops-ai
```

### 2. Set up the Backend

```bash
cd backend
npm install
```

Add your Groq API key in `server.js`:
```javascript
const GROQ_API_KEY = "your_groq_api_key_here";
```

Start the backend:
```bash
node server.js
```

Backend runs on `http://localhost:3001`

### 3. Set up the Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`

### 4. Set up the SSH Tunnel (for n8n connection)

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa
ssh -R 80:localhost:3001 -i ~/.ssh/id_rsa localhost.run
```

Copy the generated URL (e.g. `https://abc123.localhost.run`) and add it to your n8n Variable `BACKEND_URL`.

### 5. Set up n8n Workflows

In your n8n dashboard, create and activate these 3 workflows:

| Workflow | Webhook Path |
|----------|-------------|
| AutoOps Onboarding | `/webhook/autoops-start` |
| Meeting Intelligence | `/webhook/meeting-analyze` |
| Failure Recovery | `/webhook/handle-failure` |

Update `frontend/src/config/endpoints.js` with your n8n webhook URLs:
```javascript
const N8N_BASE = "https://yourname.app.n8n.cloud";
```

### 6. Verify everything is running

```
✅ Terminal 1: node server.js (backend on :3001)
✅ Terminal 2: npm run dev (frontend on :3000)
✅ Terminal 3: SSH tunnel running
✅ n8n: all 3 workflows Active (green)
```

---

## 📡 API Reference

### Workflow Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/workflow/start` | Create a new workflow |
| GET | `/api/workflow/:id` | Get full workflow state |
| POST | `/api/workflow/:id/next` | Advance to next step |
| POST | `/api/workflow/:id/fail` | Trigger failure with type |
| GET | `/api/workflow/:id/audit` | Get full audit trail |
| GET | `/api/workflow/:id/health` | Get SLA health status |
| POST | `/api/workflow/retry` | Retry a failed step |
| POST | `/api/workflow/reorder` | Reorder steps on dependency failure |
| POST | `/api/workflow/escalate` | Escalate hard failure |
| POST | `/api/workflow/n8n-plan` | Receive execution plan from n8n |

### Meeting Intelligence Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/meeting/analyze` | Analyze transcript via Groq |
| POST | `/api/meeting/tasks` | Store extracted tasks from n8n |
| GET | `/api/meeting/tasks` | Get all extracted tasks |
| PATCH | `/api/meeting/tasks/:id` | Update task status |

### Demo Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/demo/reset` | Reset all data, create fresh workflow |

---

## 🔄 Workflow Steps

The employee onboarding workflow runs these 6 steps autonomously:

```
1. HR_COLLECT_DATA        → HRAgent
2. IT_CREATE_EMAIL        → ITAgent
3. IT_SETUP_SYSTEMS       → ITAgent
4. FINANCE_SETUP_PAYROLL  → FinanceAgent
5. COMPLIANCE_VERIFY_DOCS → ComplianceAgent
6. MANAGER_ASSIGN_TASKS   → ManagerAgent
```

---

## 🔧 Self-Healing Engine

When a step fails, the Decision Agent chooses one of 3 recovery strategies:

| Failure Type | Strategy | Behavior |
|-------------|----------|----------|
| `transient` | **RETRY** | Auto-retries up to 3 times with 5s delay |
| `dependency` | **REORDER** | Skips blocked step, reorders remaining steps |
| `hard` | **ESCALATE** | Pauses workflow, drafts escalation message for human |

Every recovery decision is logged with reasoning and confidence score.

---

## 🧠 n8n Workflows

### 1. AutoOps Onboarding
```
Webhook → Initialize Workflow → Orchestrator Agent (Groq) → HTTP Request (backend) → Respond
```

### 2. Meeting Intelligence
```
Webhook → AI Agent (Groq) → Structured Output Parser → HTTP Request (backend) → Respond
```

### 3. Failure Recovery
```
Webhook → Switch Node →
  Branch A (transient): AI Agent → HTTP /retry
  Branch B (dependency): AI Agent → HTTP /reorder
  Branch C (hard): AI Agent → HTTP /escalate
→ Respond to Webhook
```

---

## 📊 Business Impact

| Metric | Before AutoOps AI | After |
|--------|------------------|-------|
| Onboarding time | 8 days | 2 days |
| Manual coordination | 68% of work time | Near zero |
| SLA breach detection | After the fact | Predictive |
| Decision auditability | 0% | 100% |
| Workflow failure recovery | Manual | Autonomous |

---

## 🔮 Future Roadmap

- [ ] Connect to real enterprise systems (SAP, Workday, ServiceNow) via n8n's 400+ integrations
- [ ] Add persistent database (PostgreSQL) for production use
- [ ] Multi-workflow parallel execution
- [ ] Custom agent training on company-specific workflows
- [ ] Role-based access control for enterprise teams
- [ ] Slack / Teams notifications for escalations
- [ ] Mobile dashboard view

---

## 📄 License

MIT License — feel free to use, modify, and build on this project.

---

*AutoOps AI — Workflows that think, decide, and heal themselves.*
