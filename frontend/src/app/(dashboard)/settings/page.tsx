"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPatch } from "@/lib/api";

interface AgentInfo {
  key: string;
  display_name: string;
  description: string;
  model: string;
  agent_id: string;
  use_mock: boolean;
  status: string;
}

interface AgentBreakdown {
  calls: number;
  tokens: number;
  cost_usd: number;
  errors: number;
  avg_latency_ms: number;
}

interface UsageReport {
  period_days: number;
  total_calls: number;
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  avg_latency_ms: number;
  error_count: number;
  error_rate: number;
  agent_breakdown: Record<string, AgentBreakdown>;
  model_breakdown: Record<string, { calls: number; tokens: number; cost_usd: number }>;
  hourly_trend: Array<{ hour: string; calls: number; tokens: number; cost_usd: number }>;
  recent_calls: Array<{
    timestamp: string;
    agent_name: string;
    model: string;
    total_tokens: number;
    cost_usd: number;
    latency_ms: number;
    status: string;
  }>;
}

interface EnvCheck {
  MISTRAL_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_WEBHOOK_SECRET: string;
  DATABASE_URL: string;
}

const STATUS_BADGES: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  mock: "bg-yellow-100 text-yellow-800",
  unconfigured: "bg-red-100 text-red-800",
  error: "bg-red-100 text-red-800",
};

const AGENT_ICONS: Record<string, string> = {
  email_classifier: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  resume_scorer: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  interview_evaluator: "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z",
  voice_screener: "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  job_generator: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
};

export default function SettingsPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [usage, setUsage] = useState<UsageReport | null>(null);
  const [envCheck, setEnvCheck] = useState<EnvCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ agent_id: "", use_mock: true });
  const [saving, setSaving] = useState(false);
  const [usageDays, setUsageDays] = useState(7);
  const [activeTab, setActiveTab] = useState<"agents" | "usage" | "system">("agents");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [agentsRes, usageRes, envRes] = await Promise.all([
        apiGet<{ agents: AgentInfo[] }>("/settings/agents"),
        apiGet<UsageReport>("/settings/llm/usage", { days: String(usageDays) }),
        apiGet<EnvCheck>("/settings/env-check"),
      ]);
      setAgents(agentsRes.agents);
      setUsage(usageRes);
      setEnvCheck(envRes);
    } catch {
      showToast("Failed to load settings", "error");
    } finally {
      setLoading(false);
    }
  }, [usageDays, showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleEdit = (agent: AgentInfo) => {
    setEditingAgent(agent.key);
    setEditForm({ agent_id: agent.agent_id, use_mock: agent.use_mock });
  };

  const handleSave = async () => {
    if (!editingAgent) return;
    setSaving(true);
    try {
      await apiPatch(`/settings/agents/${editingAgent}`, editForm);
      showToast("Agent configuration updated");
      setEditingAgent(null);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { key: "agents" as const, label: "Agent Configuration" },
    { key: "usage" as const, label: "LLM Usage Report" },
    { key: "system" as const, label: "System" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <svg className="animate-spin h-8 w-8 text-indigo-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
        }`}>
          {toast.message}
        </div>
      )}

      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Settings</h1>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-6">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.key
                  ? "bg-white text-indigo-700 border-b-2 border-indigo-600"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ Agent Configuration Tab ═══ */}
      {activeTab === "agents" && (
        <div className="space-y-4">
          {agents.map((agent) => (
            <div key={agent.key} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={AGENT_ICONS[agent.key] || "M13 10V3L4 14h7v7l9-11h-7z"} />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{agent.display_name}</h3>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGES[agent.status] || STATUS_BADGES.error}`}>
                        {agent.status === "active" ? "Live" : agent.status === "mock" ? "Mock Mode" : agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 mt-1">{agent.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                      <span>Model: <span className="font-mono text-slate-600">{agent.model}</span></span>
                      {agent.agent_id && (
                        <span>Agent ID: <span className="font-mono text-slate-600">{agent.agent_id.slice(0, 20)}...</span></span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleEdit(agent)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                >
                  Configure
                </button>
              </div>

              {/* Edit Form */}
              {editingAgent === agent.key && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Agent ID</label>
                      <input
                        type="text"
                        value={editForm.agent_id}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, agent_id: e.target.value }))}
                        placeholder="ag_xxxxxxxxxxxxx"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Mode</label>
                      <div className="flex items-center gap-4 mt-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            checked={!editForm.use_mock}
                            onChange={() => setEditForm((prev) => ({ ...prev, use_mock: false }))}
                            className="text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-sm text-slate-700">Live (Real API)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            checked={editForm.use_mock}
                            onChange={() => setEditForm((prev) => ({ ...prev, use_mock: true }))}
                            className="text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-sm text-slate-700">Mock (Demo)</span>
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-4">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingAgent(null)}
                      className="px-4 py-2 text-sm font-medium rounded-lg text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ═══ LLM Usage Report Tab ═══ */}
      {activeTab === "usage" && usage && (
        <div className="space-y-6">
          {/* Period Selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">Period:</span>
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setUsageDays(d)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  usageDays === d ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {d === 1 ? "24h" : `${d}d`}
              </button>
            ))}
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total API Calls</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{usage.total_calls}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Tokens</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{usage.total_tokens.toLocaleString()}</p>
              <p className="text-xs text-slate-400 mt-1">
                {usage.total_input_tokens.toLocaleString()} in / {usage.total_output_tokens.toLocaleString()} out
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Cost</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">${usage.total_cost_usd.toFixed(4)}</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Avg Latency</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{usage.avg_latency_ms}ms</p>
              <p className="text-xs mt-1">
                {usage.error_count > 0 ? (
                  <span className="text-red-600">{usage.error_rate}% error rate</span>
                ) : (
                  <span className="text-green-600">0% errors</span>
                )}
              </p>
            </div>
          </div>

          {/* Agent Breakdown */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-4">Usage by Agent</h3>
            {Object.keys(usage.agent_breakdown).length === 0 ? (
              <p className="text-sm text-slate-400 italic">No API calls recorded yet. Use the agents to see usage data.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider pb-3">Agent</th>
                      <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider pb-3">Calls</th>
                      <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider pb-3">Tokens</th>
                      <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider pb-3">Cost</th>
                      <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider pb-3">Avg Latency</th>
                      <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider pb-3">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {Object.entries(usage.agent_breakdown).map(([name, data]) => (
                      <tr key={name} className="hover:bg-slate-50">
                        <td className="py-3 text-sm font-medium text-slate-900">{name}</td>
                        <td className="py-3 text-sm text-slate-700 text-right">{data.calls}</td>
                        <td className="py-3 text-sm text-slate-700 text-right">{data.tokens.toLocaleString()}</td>
                        <td className="py-3 text-sm text-slate-700 text-right">${data.cost_usd.toFixed(4)}</td>
                        <td className="py-3 text-sm text-slate-700 text-right">{data.avg_latency_ms}ms</td>
                        <td className="py-3 text-sm text-right">
                          {data.errors > 0 ? (
                            <span className="text-red-600 font-medium">{data.errors}</span>
                          ) : (
                            <span className="text-green-600">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Model Breakdown */}
          {Object.keys(usage.model_breakdown).length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-base font-semibold text-slate-900 mb-4">Usage by Model</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(usage.model_breakdown).map(([model, data]) => (
                  <div key={model} className="border border-slate-200 rounded-lg p-4">
                    <p className="text-xs font-mono text-slate-500">{model}</p>
                    <div className="flex items-baseline gap-3 mt-1">
                      <span className="text-lg font-bold text-slate-900">{data.calls}</span>
                      <span className="text-xs text-slate-400">calls</span>
                      <span className="text-sm text-slate-600">{data.tokens.toLocaleString()} tokens</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">${data.cost_usd.toFixed(4)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Calls Log */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-4">Recent API Calls</h3>
            {usage.recent_calls.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No recent calls.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {usage.recent_calls.slice().reverse().map((call, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${
                      call.status === "error" ? "bg-red-50" : "bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${call.status === "error" ? "bg-red-500" : "bg-green-500"}`} />
                      <span className="font-medium text-slate-700">{call.agent_name}</span>
                      <span className="font-mono text-slate-400">{call.model}</span>
                    </div>
                    <div className="flex items-center gap-4 text-slate-500">
                      <span>{call.total_tokens} tokens</span>
                      <span>${call.cost_usd.toFixed(4)}</span>
                      <span>{call.latency_ms}ms</span>
                      <span className="text-slate-400">{new Date(call.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ System Tab ═══ */}
      {activeTab === "system" && envCheck && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-4">Environment Variables</h3>
            <div className="space-y-3">
              {Object.entries(envCheck).map(([key, status]) => (
                <div key={key} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="text-sm font-mono text-slate-700">{key}</span>
                  {status === "set" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Configured
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Missing
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-4">Workflow Pipeline</h3>
            <div className="flex items-center gap-2 flex-wrap">
              {["New Email", "Classify", "Create Candidate", "Match to Job", "Score Resume", "Voice Screen", "Evaluate", "Decision"].map((step, i) => (
                <div key={step} className="flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {step}
                  </span>
                  {i < 7 && (
                    <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-3">
              Auto-workflow triggers automatically when Gmail polling is active. Each step uses the configured agent (mock or live).
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-base font-semibold text-slate-900 mb-2">System Info</h3>
            <div className="text-sm text-slate-600 space-y-1">
              <p>Version: <span className="font-mono">1.0.0</span></p>
              <p>Backend: <span className="font-mono">FastAPI + PostgreSQL</span></p>
              <p>Frontend: <span className="font-mono">Next.js 15 + TypeScript</span></p>
              <p>LLM: <span className="font-mono">Mistral AI</span></p>
              <p>Voice: <span className="font-mono">ElevenLabs</span></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
