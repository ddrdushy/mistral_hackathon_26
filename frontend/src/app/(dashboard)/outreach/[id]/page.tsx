"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  TrashIcon,
  PlusIcon,
  EnvelopeIcon,
  ChatBubbleLeftRightIcon,
  PhoneIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api";

interface Step {
  id: number;
  sequence_id: number;
  order_index: number;
  channel: string;
  delay_hours: number;
  template_subject: string;
  template_body: string;
}

interface Sequence {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  stop_on_reply: boolean;
  stop_on_meeting_booked: boolean;
  steps: Step[];
  stats?: Record<string, number>;
}

interface Enrollment {
  id: number;
  status: string;
  paused_reason: string;
  current_step_index: number;
  started_at: string | null;
  completed_at: string | null;
  candidate: { id: number; name: string; email: string } | null;
  sequence_name: string;
}

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  email: <EnvelopeIcon className="h-4 w-4" />,
  whatsapp: <ChatBubbleLeftRightIcon className="h-4 w-4" />,
  sms: <PhoneIcon className="h-4 w-4" />,
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-slate-100 text-slate-700",
  stopped: "bg-rose-100 text-rose-700",
  failed: "bg-rose-100 text-rose-700",
};

export default function SequenceEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const seqId = Number(id);

  const [seq, setSeq] = useState<Sequence | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [s, e] = await Promise.all([
        apiGet<Sequence>(`/outreach/sequences/${seqId}`),
        apiGet<{ enrollments: Enrollment[] }>(`/outreach/enrollments?sequence_id=${seqId}`),
      ]);
      setSeq(s);
      setEnrollments(e.enrollments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [seqId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateSeq = async (patch: Partial<Sequence>) => {
    try {
      await apiPut(`/outreach/sequences/${seqId}`, patch);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  const addStep = async () => {
    try {
      await apiPost(`/outreach/sequences/${seqId}/steps`, {
        channel: "email",
        delay_hours: seq?.steps.length === 0 ? 0 : 24,
        template_subject: "Following up on your application",
        template_body: "Hi {{candidate.first_name}},\n\n…",
      });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Add step failed");
    }
  };

  const updateStep = async (sid: number, patch: Partial<Step>) => {
    try {
      await apiPut(`/outreach/sequences/${seqId}/steps/${sid}`, patch);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update step failed");
    }
  };

  const removeStep = async (sid: number) => {
    if (!confirm("Delete this step?")) return;
    try {
      await apiDelete(`/outreach/sequences/${seqId}/steps/${sid}`);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete step failed");
    }
  };

  const reorderStep = async (sid: number, dir: -1 | 1) => {
    if (!seq) return;
    const ids = seq.steps.map((s) => s.id);
    const idx = ids.indexOf(sid);
    if (idx < 0) return;
    const t = idx + dir;
    if (t < 0 || t >= ids.length) return;
    [ids[idx], ids[t]] = [ids[t], ids[idx]];
    try {
      await apiPost(`/outreach/sequences/${seqId}/steps/reorder`, { step_ids: ids });
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reorder failed");
    }
  };

  const stopEnrollment = async (eid: number) => {
    if (!confirm("Stop this enrollment? Pending messages will be cancelled.")) return;
    try {
      await apiPost(`/outreach/enrollments/${eid}/stop`);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Stop failed");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-12 bg-white border border-slate-200 rounded animate-pulse" />
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!seq) {
    return (
      <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
        {error || "Sequence not found"}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/outreach"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 mb-1"
        >
          <ArrowLeftIcon className="h-3 w-3" />
          Outreach sequences
        </Link>
        <div className="flex items-center justify-between gap-3">
          <input
            type="text"
            value={seq.name}
            onChange={(e) => setSeq({ ...seq, name: e.target.value })}
            onBlur={(e) => {
              if (e.target.value !== seq.name) updateSeq({ name: e.target.value });
            }}
            className="text-2xl font-semibold text-slate-900 bg-transparent border-0 focus:outline-none focus:ring-0 flex-1 p-0"
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={seq.stop_on_reply}
                onChange={(e) => updateSeq({ stop_on_reply: e.target.checked })}
                className="rounded border-slate-300"
              />
              Stop on reply
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={seq.is_active}
                onChange={(e) => updateSeq({ is_active: e.target.checked })}
                className="rounded border-slate-300"
              />
              Active
            </label>
          </div>
        </div>
        <textarea
          value={seq.description}
          onChange={(e) => setSeq({ ...seq, description: e.target.value })}
          onBlur={(e) => {
            if (e.target.value !== seq.description) updateSeq({ description: e.target.value });
          }}
          rows={1}
          placeholder="Optional description"
          className="text-sm text-slate-500 bg-transparent border-0 focus:outline-none focus:ring-0 mt-0.5 w-full p-0 resize-none"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        {/* Steps editor */}
        <div className="space-y-3">
          {seq.steps.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
              <p className="text-sm text-slate-500 mb-3">No steps yet.</p>
              <button
                type="button"
                onClick={addStep}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
              >
                <PlusIcon className="h-4 w-4" />
                Add first step
              </button>
            </div>
          ) : (
            seq.steps.map((step, i) => (
              <div
                key={step.id}
                className="bg-white border border-slate-200 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => reorderStep(step.id, -1)}
                      disabled={i === 0}
                      className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    >
                      <ChevronUpIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderStep(step.id, 1)}
                      disabled={i === seq.steps.length - 1}
                      className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    >
                      <ChevronDownIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Step {i + 1}
                  </span>
                  <select
                    value={step.channel}
                    onChange={(e) => updateStep(step.id, { channel: e.target.value })}
                    className="text-xs px-2 py-1 border border-slate-300 rounded inline-flex items-center"
                  >
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="sms">SMS</option>
                  </select>
                  <span className="ml-2 text-slate-400">{CHANNEL_ICON[step.channel]}</span>
                  <span className="text-xs text-slate-500 ml-3">Delay:</span>
                  <input
                    type="number"
                    value={step.delay_hours}
                    onChange={(e) =>
                      updateStep(step.id, { delay_hours: Number(e.target.value) || 0 })
                    }
                    min={0}
                    className="w-20 text-xs px-2 py-1 border border-slate-300 rounded"
                  />
                  <span className="text-xs text-slate-500">h</span>
                  <button
                    type="button"
                    onClick={() => removeStep(step.id)}
                    className="ml-auto text-rose-500 hover:text-rose-700"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>

                {step.channel === "email" && (
                  <input
                    type="text"
                    value={step.template_subject}
                    onChange={(e) => updateStep(step.id, { template_subject: e.target.value })}
                    placeholder="Subject"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md mb-2 font-medium"
                  />
                )}
                <textarea
                  value={step.template_body}
                  onChange={(e) => updateStep(step.id, { template_body: e.target.value })}
                  rows={4}
                  placeholder="Body — use {{candidate.first_name}}, {{job.title}}, {{recruiter.name}}"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md font-mono"
                />
              </div>
            ))
          )}

          {seq.steps.length > 0 && seq.steps.length < 12 && (
            <button
              type="button"
              onClick={addStep}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md border border-dashed border-indigo-300"
            >
              <PlusIcon className="h-4 w-4" />
              Add step
            </button>
          )}

          <p className="text-[11px] text-slate-500">
            Merge tags: <code className="font-mono">{`{{candidate.first_name}}`}</code>{" "}
            <code className="font-mono">{`{{candidate.email}}`}</code>{" "}
            <code className="font-mono">{`{{job.title}}`}</code>{" "}
            <code className="font-mono">{`{{recruiter.name}}`}</code>{" "}
            <code className="font-mono">{`{{tenant.name}}`}</code>
          </p>
        </div>

        {/* Right rail: enrollments */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">
            Enrollments ({enrollments.length})
          </h3>
          {enrollments.length === 0 ? (
            <p className="text-xs text-slate-500">
              No candidates enrolled. Use the &quot;Enroll in sequence&quot; button on the
              Talent Bank or candidate detail page.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 -mx-2">
              {enrollments.slice(0, 30).map((e) => (
                <li key={e.id} className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                        STATUS_BADGE[e.status] || STATUS_BADGE.completed
                      }`}
                    >
                      {e.status}
                    </span>
                    <Link
                      href={`/candidates/${e.candidate?.id ?? ""}`}
                      className="text-sm font-medium text-slate-800 hover:text-indigo-700 truncate flex-1"
                    >
                      {e.candidate?.name || `#${e.id}`}
                    </Link>
                    {e.status === "active" && (
                      <button
                        type="button"
                        onClick={() => stopEnrollment(e.id)}
                        className="text-xs text-rose-600 hover:text-rose-800"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Step {(e.current_step_index ?? 0) + 1}
                    {e.paused_reason && ` · ${e.paused_reason}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
