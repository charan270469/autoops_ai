import { useEffect, useRef, useState } from "react";
import {
  UserCheck,
  Mail,
  Monitor,
  DollarSign,
  Shield,
  ClipboardList,
  Play,
  AlertTriangle,
  RefreshCw,
  SkipForward,
  ChevronRight,
  Loader2,
  Radio,
} from "lucide-react";
import { ENDPOINTS } from "../config/endpoints.js";

const STEP_ICONS = [
  UserCheck,
  Mail,
  Monitor,
  DollarSign,
  Shield,
  ClipboardList,
];

/** @type {Record<string, string>} */
const STEP_TITLES = {
  HR_COLLECT_DATA: "Collect HR Data",
  IT_CREATE_EMAIL: "Create Email Account",
  IT_SETUP_SYSTEMS: "Setup IT Systems",
  FINANCE_SETUP_PAYROLL: "Setup Payroll",
  COMPLIANCE_VERIFY_DOCS: "Verify Compliance Documents",
  MANAGER_ASSIGN_TASKS: "Assign Manager Tasks",
};

function titleForStepId(id) {
  return STEP_TITLES[id] || id.replace(/_/g, " ");
}

function statusBadgeClass(status) {
  switch (status) {
    case "pending":
      return "bg-gray-800 text-gray-300 ring-1 ring-gray-600";
    case "running":
      return "bg-blue-950 text-blue-200 ring-1 ring-blue-500 animate-pulse";
    case "success":
      return "bg-emerald-950/80 text-emerald-200 ring-1 ring-emerald-600";
    case "failed":
      return "bg-red-950/80 text-red-200 ring-1 ring-red-600";
    case "skipped":
      return "bg-yellow-950/50 text-yellow-100 ring-1 ring-yellow-600";
    default:
      return "bg-orange-950/50 text-orange-100 ring-1 ring-orange-600";
  }
}

function cardClass(status) {
  const base = "rounded-xl border px-4 py-3 transition-colors";
  switch (status) {
    case "pending":
      return `${base} border-gray-700/80 bg-gray-900/40`;
    case "running":
      return `${base} border-blue-500/60 bg-blue-950/30 shadow-[0_0_20px_rgba(59,130,246,0.12)]`;
    case "success":
      return `${base} border-emerald-800/60 bg-emerald-950/20`;
    case "failed":
      return `${base} border-red-700/60 bg-red-950/25`;
    case "skipped":
      return `${base} border-yellow-700/50 bg-yellow-950/20`;
    default:
      return `${base} border-orange-700/50 bg-orange-950/20`;
  }
}

/**
 * @param {{
 *   selectedWorkflowId: string | null,
 *   snapshot: object | undefined,
 *   onMergeSnapshot: (id: string, snapshot: object) => void,
 *   wsConnected: boolean,
 *   n8nOnboardingPlan?: unknown,
 *   onToast?: (message: string) => void,
 * }} props
 */
export function WorkflowPanel({
  selectedWorkflowId,
  snapshot,
  onMergeSnapshot,
  wsConnected,
  n8nOnboardingPlan,
  onToast,
}) {
  const [fetching, setFetching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [simulateOpen, setSimulateOpen] = useState(false);

  const selectedRef = useRef(selectedWorkflowId);
  selectedRef.current = selectedWorkflowId;

  useEffect(() => {
    setAutoAdvance(false);
  }, [selectedWorkflowId]);

  /** Fetch workflow whenever selection changes (and on mount with id) */
  useEffect(() => {
    if (!selectedWorkflowId) {
      return;
    }
    let cancelled = false;
    setFetching(true);
    (async () => {
      try {
        const res = await fetch(ENDPOINTS.workflowStatus(selectedWorkflowId));
        const data = await res.json().catch(() => null);
        if (cancelled || !data) return;
        if (res.ok) {
          onMergeSnapshot(selectedWorkflowId, data);
        }
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWorkflowId, onMergeSnapshot]);

  /** Auto-advance uses current selected id */
  useEffect(() => {
    if (!autoAdvance || !selectedWorkflowId) return;

    const tick = async () => {
      const id = selectedRef.current;
      if (!id) return;
      try {
        const res = await fetch(ENDPOINTS.workflowNext(id), {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          onMergeSnapshot(id, data);
          if (
            data.runStatus === "completed" ||
            data.runStatus === "escalated" ||
            data.runStatus !== "active"
          ) {
            setAutoAdvance(false);
          }
          return;
        }
        const msg = data.error || "";
        if (msg.includes("No more steps")) {
          setAutoAdvance(false);
        }
      } catch {
        setAutoAdvance(false);
      }
    };

    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [autoAdvance, selectedWorkflowId, onMergeSnapshot]);

  /** @param {object | undefined} snap */
  const currentStepName = (snap) => {
    if (!snap?.steps?.length) return "";
    const running = snap.steps.find((s) => s.status === "running");
    if (running) return running.id;
    const idx = snap.nextStepIndex ?? 0;
    return snap.steps[idx]?.id ?? "";
  };

  const callFail = async (failureType) => {
    const id = selectedRef.current;
    if (!id || !snapshot) return;
    setBusy(true);
    try {
      const stepName = currentStepName(snapshot);
      const n8nBody = {
        workflowId: id,
        stepName,
        failureType,
        errorMessage: "Simulated failure for demo",
        attemptNumber: 1,
      };
      const [res] = await Promise.all([
        fetch(ENDPOINTS.workflowFail(id), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ failureType }),
        }),
        fetch(ENDPOINTS.n8nFailure, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(n8nBody),
        }).catch(() => null),
      ]);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onMergeSnapshot(id, data);
        const msg =
          failureType === "transient"
            ? "Retrying automatically..."
            : failureType === "dependency"
              ? "Reordering steps..."
              : "Escalating to human...";
        onToast?.(msg);
      }
    } finally {
      setBusy(false);
      setSimulateOpen(false);
    }
  };

  const automatedCount =
    snapshot?.steps?.filter((s) => s.status === "success").length ?? 0;
  const hasFailedStep = snapshot?.steps?.some((s) => s.status === "failed");
  const steps = snapshot?.steps ?? [];

  if (!selectedWorkflowId) {
    return (
      <p className="text-sm text-gray-500">
        Select a workflow from the sidebar, or click <strong>New</strong> to
        create one.
      </p>
    );
  }

  if (fetching && !snapshot) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading workflow…
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
        Could not load workflow state. It may have been removed from the server.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {n8nOnboardingPlan != null && (
        <div className="rounded-xl border border-blue-800/50 bg-blue-950/25 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-blue-300/90">
            n8n orchestration plan
          </p>
          <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] leading-relaxed text-blue-100/90">
            {typeof n8nOnboardingPlan === "string"
              ? n8nOnboardingPlan
              : JSON.stringify(n8nOnboardingPlan, null, 2)}
          </pre>
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            Autonomy score
          </div>
          <div className="text-2xl font-semibold text-white">
            <span className="text-cyan-400">{automatedCount}</span>
            <span className="text-gray-500">/6</span>
            <span className="ml-2 text-base font-normal text-gray-400">
              steps automated
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
            <Radio
              className={`h-3.5 w-3.5 ${wsConnected ? "text-emerald-400" : "text-gray-600"}`}
            />
            WebSocket {wsConnected ? "connected" : "disconnected"}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={snapshot.runStatus !== "active" || busy}
            onClick={() => setAutoAdvance((a) => !a)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
              autoAdvance
                ? "bg-amber-700 text-white hover:bg-amber-600"
                : "bg-blue-700 text-white hover:bg-blue-600"
            } disabled:opacity-40`}
          >
            <Play className="h-4 w-4" />
            {autoAdvance ? "Stop auto-run" : "Start workflow"}
          </button>
          <button
            type="button"
            disabled={snapshot.runStatus !== "active" || busy}
            onClick={() => setSimulateOpen((o) => !o)}
            className="inline-flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-2 text-sm text-red-200 hover:bg-red-950/50 disabled:opacity-40"
          >
            <AlertTriangle className="h-4 w-4" />
            Simulate failure
          </button>
        </div>
      </div>

      {simulateOpen && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/15 px-4 py-3">
          <p className="mb-2 text-xs text-red-200/90">Choose failure policy:</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => callFail("transient")}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-xs text-gray-100 hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Transient
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => callFail("dependency")}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-xs text-gray-100 hover:bg-slate-700"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Dependency
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => callFail("hard")}
              className="inline-flex items-center gap-1 rounded-lg bg-orange-950/60 px-3 py-2 text-xs text-orange-100 hover:bg-orange-900/80"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              Hard
            </button>
          </div>
        </div>
      )}

      {hasFailedStep && (
        <div className="rounded-xl border border-red-600/60 bg-red-950/40 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-100">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Step failure detected — trigger recovery
          </div>
          <p className="mb-3 text-xs text-red-200/80">
            Select how the engine should respond (passed to the Decision Agent as
            a hint).
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || snapshot.runStatus !== "active"}
              onClick={() => callFail("transient")}
              className="rounded-lg bg-red-900/60 px-3 py-1.5 text-xs text-red-50 hover:bg-red-800/80 disabled:opacity-40"
            >
              Transient
            </button>
            <button
              type="button"
              disabled={busy || snapshot.runStatus !== "active"}
              onClick={() => callFail("dependency")}
              className="rounded-lg bg-red-900/60 px-3 py-1.5 text-xs text-red-50 hover:bg-red-800/80 disabled:opacity-40"
            >
              Dependency
            </button>
            <button
              type="button"
              disabled={busy || snapshot.runStatus !== "active"}
              onClick={() => callFail("hard")}
              className="rounded-lg bg-orange-900/50 px-3 py-1.5 text-xs text-orange-100 hover:bg-orange-900/80 disabled:opacity-40"
            >
              Hard
            </button>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Onboarding pipeline
        </h3>
        <ul className="relative space-y-0">
          {steps.map((s, idx) => {
            const Icon = STEP_ICONS[idx] || ClipboardList;
            const isLast = idx === steps.length - 1;
            return (
              <li key={s.id} className="relative flex gap-0">
                <div className="flex w-14 shrink-0 flex-col items-center">
                  <div
                    className={`relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#1a1d2e] bg-[#12141c] ${
                      s.status === "running" ? "ring-2 ring-blue-500/50" : ""
                    }`}
                  >
                    <Icon className="h-5 w-5 text-cyan-400/90" />
                  </div>
                  {!isLast && (
                    <div
                      className="w-px flex-1 min-h-[1.5rem] bg-gradient-to-b from-gray-700 to-gray-800"
                      aria-hidden
                    />
                  )}
                </div>

                <div className={`min-w-0 flex-1 pb-8 ${isLast ? "pb-0" : ""}`}>
                  <div className={cardClass(s.status)}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="font-medium text-gray-100">
                          {titleForStepId(s.id)}
                        </h4>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {s.assignedAgent}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(s.status)}`}
                      >
                        {s.status}
                      </span>
                    </div>
                    {s.status === "success" && s.duration != null && (
                      <p className="mt-2 text-xs text-emerald-400/90">
                        Completed in {s.duration}s
                      </p>
                    )}
                    {s.status === "failed" && (
                      <p className="mt-2 text-xs text-red-300/90">
                        Step failed — use recovery actions above.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="font-mono text-[10px] text-gray-600">
        Workflow ID: {selectedWorkflowId}
      </p>
    </div>
  );
}
