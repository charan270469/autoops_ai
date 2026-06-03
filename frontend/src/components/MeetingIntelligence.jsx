import { useMemo, useState } from "react";
import {
  Mic2,
  Sparkles,
  Loader2,
  Calendar,
  CheckCircle2,
  FlaskConical,
} from "lucide-react";
import { ENDPOINTS } from "../config/endpoints.js";

const SAMPLE_TRANSCRIPT = `AutoOps standup — March 28
Sarah (HR): We need to finish onboarding for the new engineer by Friday. Please verify I-9 and add them to the handbook acknowledgment queue.
Mike (IT): I'll create the email and laptop bundle today. Dependencies: HR must confirm desk assignment first.
Alex (Finance): Payroll setup blocked until we have the employee ID from HR — target EOD Wednesday.
Jordan (Compliance): High priority — review export control checklist before the customer demo next week.
Sam (Manager): I'll assign the buddy mentor and first sprint tasks once IT marks the account ready.`;

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function priorityClass(p) {
  const u = String(p).toUpperCase();
  if (u.includes("HIGH")) return "bg-red-500/20 text-red-300 ring-1 ring-red-500/40";
  if (u.includes("LOW")) return "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40";
  return "bg-amber-500/20 text-amber-100 ring-1 ring-amber-500/40";
}

export function MeetingIntelligence() {
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [analysisKey, setAnalysisKey] = useState(0);
  /** @type {Set<string>} */
  const [completed, setCompleted] = useState(() => new Set());

  const analyze = async () => {
    setErr(null);
    setLoading(true);
    try {
      const [res] = await Promise.all([
        fetch(ENDPOINTS.meetingAnalyze, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        }),
        fetch(ENDPOINTS.n8nMeeting, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        }).catch(() => null),
      ]);

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setResult(data);
      setCompleted(new Set());
      setAnalysisKey((k) => k + 1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const summaryPreview = useMemo(() => {
    const s = result?.summary;
    if (!s || typeof s !== "string") return "";
    const parts = s.split(/(?<=[.!?])\s+/).filter(Boolean);
    return parts.slice(0, 2).join(" ");
  }, [result]);

  const tasks = result?.tasks ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
        <Mic2 className="h-4 w-4 text-fuchsia-400" />
        Meeting intelligence
      </div>

      <div className="grid min-h-[420px] gap-6 lg:grid-cols-2">
        <div className="flex flex-col rounded-xl border border-shell-border bg-shell-card p-4">
          <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Paste meeting transcript here…
          </label>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={14}
            placeholder="Paste raw meeting notes…"
            className="min-h-[280px] w-full flex-1 resize-y rounded-lg border border-shell-border bg-[#0f1117] px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-cyan-700 focus:outline-none focus:ring-1 focus:ring-cyan-700"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTranscript(SAMPLE_TRANSCRIPT)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-700/50 bg-violet-950/30 px-3 py-2 text-xs font-medium text-violet-200 hover:bg-violet-950/50"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Load sample transcript
            </button>
          </div>
          <button
            type="button"
            onClick={analyze}
            disabled={loading || !transcript.trim()}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-40"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Analyze Meeting
              </>
            )}
          </button>
          {err && (
            <p className="mt-2 text-sm text-red-400">{err}</p>
          )}
        </div>

        <div className="min-h-[280px] rounded-xl border border-shell-border bg-shell-card p-4">
          {!result ? (
            <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-gray-600">
              Run analysis to see extracted tasks here.
            </div>
          ) : (
            <div key={analysisKey} className="space-y-4 meeting-results-enter">
              <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/20 px-4 py-3">
                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="text-gray-400">
                    Total tasks:{" "}
                    <strong className="text-white">{result.totalTasks ?? tasks.length}</strong>
                  </span>
                  <span className="text-gray-400">
                    High priority:{" "}
                    <strong className="text-red-300">
                      {result.highPriorityCount ?? 0}
                    </strong>
                  </span>
                </div>
                {summaryPreview && (
                  <p className="mt-3 text-sm leading-relaxed text-gray-300">
                    {summaryPreview}
                  </p>
                )}
              </div>

              <div className="max-h-[min(52vh,480px)] space-y-3 overflow-y-auto pr-1">
                {tasks.map((t, i) => {
                  const id = `task-${i}`;
                  const done = completed.has(id);
                  const deps = Array.isArray(t.dependencies)
                    ? t.dependencies.join(", ")
                    : t.dependencies || "";
                  return (
                    <div
                      key={id}
                      className={`rounded-xl border px-4 py-3 transition-opacity ${
                        done
                          ? "border-gray-700/80 bg-gray-900/30 opacity-60"
                          : "border-shell-border bg-[#0f1117]/80"
                      }`}
                    >
                      <p className="text-sm font-medium text-gray-100">{t.task}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <div
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-xs font-bold text-white"
                          title={t.owner}
                        >
                          {initials(t.owner)}
                        </div>
                        <span className="text-sm text-gray-400">{t.owner}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Calendar className="h-3.5 w-3.5" />
                          {t.deadline || "TBD"}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${priorityClass(t.priority)}`}
                        >
                          {t.priority}
                        </span>
                      </div>
                      {deps ? (
                        <p className="mt-2 text-xs text-gray-500">
                          Dependencies: {deps}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        disabled={done}
                        onClick={() =>
                          setCompleted((prev) => new Set([...prev, id]))
                        }
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-950/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {done ? "Completed" : "Mark Complete"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
