"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { timeAgo } from "@/lib/constants";
import type { Email, EmailListResponse } from "@/types/index";

type FilterTab = "all" | "candidate_application" | "general";

interface GmailStatus {
  connected: boolean;
  email: string | null;
  polling: boolean;
  poll_interval: number | null;
  last_sync_at: string | null;
  total_processed: number;
  recent_results: Array<{
    email_id: number;
    subject?: string;
    from?: string;
    result?: Record<string, unknown>;
    error?: string;
    timestamp: string;
  }>;
}

const CLASSIFICATION_BADGES: Record<string, string> = {
  candidate_application: "bg-green-100 text-green-800",
  general: "bg-gray-100 text-gray-700",
  unknown: "bg-yellow-100 text-yellow-800",
};

export default function InboxPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");

  // Gmail state
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [showGmailConnect, setShowGmailConnect] = useState(false);
  const [gmailEmail, setGmailEmail] = useState("");
  const [gmailPassword, setGmailPassword] = useState("");
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Legacy sample mode
  const [connectStatus, setConnectStatus] = useState<string>("");
  const [connectLoading, setConnectLoading] = useState(false);
  const [classifyLoading, setClassifyLoading] = useState(false);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [creatingCandidate, setCreatingCandidate] = useState<number | null>(null);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        per_page: String(perPage),
      };
      if (filter !== "all") {
        params.classified_as = filter;
      }
      const data = await apiGet<EmailListResponse>("/inbox/emails", params);
      setEmails(data.emails);
      setTotal(data.total);
    } catch {
      showToast("Failed to load emails", "error");
    } finally {
      setLoading(false);
    }
  }, [page, perPage, filter, showToast]);

  const fetchGmailStatus = useCallback(async () => {
    try {
      const status = await apiGet<GmailStatus>("/inbox/gmail/status");
      setGmailStatus(status);
    } catch {
      // Gmail not set up yet, that's OK
    }
  }, []);

  useEffect(() => {
    fetchEmails();
    fetchGmailStatus();
  }, [fetchEmails, fetchGmailStatus]);

  // Poll Gmail status every 10s when auto-workflow is active
  useEffect(() => {
    if (gmailStatus?.polling) {
      statusPollRef.current = setInterval(() => {
        fetchGmailStatus();
        fetchEmails();
      }, 10000);
    }
    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
    };
  }, [gmailStatus?.polling, fetchGmailStatus, fetchEmails]);

  // ─── Gmail Handlers ───

  const handleGmailConnect = async () => {
    if (!gmailEmail.trim() || !gmailPassword.trim()) {
      showToast("Enter your Gmail address and App Password", "error");
      return;
    }

    setGmailConnecting(true);
    try {
      await apiPost("/inbox/gmail/connect", {
        email: gmailEmail.trim(),
        app_password: gmailPassword.trim(),
      });
      showToast("Gmail connected successfully!");
      setShowGmailConnect(false);
      setGmailPassword("");
      await fetchGmailStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      showToast(message, "error");
    } finally {
      setGmailConnecting(false);
    }
  };

  const handleGmailSync = async () => {
    setGmailSyncing(true);
    try {
      const result = await apiPost<{ synced_count: number; workflow_results: unknown[] }>(
        "/inbox/gmail/sync-and-process"
      );
      showToast(`Synced ${result.synced_count} emails and ran auto-workflow`);
      fetchEmails();
      fetchGmailStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      showToast(message, "error");
    } finally {
      setGmailSyncing(false);
    }
  };

  const handleStartAutoWorkflow = async () => {
    try {
      await apiPost("/inbox/gmail/watch", { interval: 30 });
      showToast("Auto-workflow started! Checking every 30 seconds.");
      fetchGmailStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start auto-workflow";
      showToast(message, "error");
    }
  };

  const handleStopAutoWorkflow = async () => {
    try {
      await apiPost("/inbox/gmail/stop");
      showToast("Auto-workflow stopped.");
      fetchGmailStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stop";
      showToast(message, "error");
    }
  };

  // ─── Legacy Handlers ───

  const handleConnect = async () => {
    setConnectLoading(true);
    setConnectStatus("Connecting...");
    try {
      await apiPost("/inbox/connect", { mode: "sample" });
      setConnectStatus("Syncing...");
      await apiPost("/inbox/sync");
      setConnectStatus("Synced");
      showToast("Sample inbox loaded");
      setPage(1);
      fetchEmails();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setConnectStatus("Failed");
      showToast(message, "error");
    } finally {
      setConnectLoading(false);
    }
  };

  const handleClassify = async () => {
    setClassifyLoading(true);
    try {
      await apiPost("/inbox/classify");
      showToast("Emails classified");
      fetchEmails();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Classification failed";
      showToast(message, "error");
    } finally {
      setClassifyLoading(false);
    }
  };

  const handleRunWorkflow = async () => {
    setWorkflowLoading(true);
    try {
      const result = await apiPost<{ processed_count: number }>("/inbox/workflow/run");
      showToast(`Auto-workflow processed ${result.processed_count} emails`);
      fetchEmails();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workflow failed";
      showToast(message, "error");
    } finally {
      setWorkflowLoading(false);
    }
  };

  const handleCreateCandidate = async (emailId: number) => {
    setCreatingCandidate(emailId);
    try {
      await apiPost(`/candidates/from-email/${emailId}`);
      showToast("Candidate created");
      fetchEmails();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create candidate";
      showToast(message, "error");
    } finally {
      setCreatingCandidate(null);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  const filterTabs: { label: string; value: FilterTab }[] = [
    { label: "All", value: "all" },
    { label: "Applications", value: "candidate_application" },
    { label: "General", value: "general" },
  ];

  return (
    <div>
      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all max-w-md ${
            toast.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}

      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Inbox</h1>

      {/* ═══ Gmail Connect Section ═══ */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-medium text-slate-900">Gmail Integration</h2>
                <p className="text-sm text-slate-500">
                  {gmailStatus?.connected ? (
                    <>
                      Connected to <span className="font-medium text-slate-700">{gmailStatus.email}</span>
                      {gmailStatus.polling && (
                        <span className="ml-2 inline-flex items-center gap-1 text-green-600">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                          </span>
                          Auto-workflow active
                        </span>
                      )}
                    </>
                  ) : (
                    "Connect your Gmail to auto-process incoming emails"
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {gmailStatus?.connected ? (
                <>
                  <button
                    onClick={handleGmailSync}
                    disabled={gmailSyncing}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                  >
                    {gmailSyncing ? (
                      <>
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Syncing...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Sync Now
                      </>
                    )}
                  </button>
                  {gmailStatus.polling ? (
                    <button
                      onClick={handleStopAutoWorkflow}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-red-700 bg-red-50 hover:bg-red-100 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                      </svg>
                      Stop Auto-Workflow
                    </button>
                  ) : (
                    <button
                      onClick={handleStartAutoWorkflow}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-white bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 transition-all shadow-sm"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Start Auto-Workflow
                    </button>
                  )}
                </>
              ) : (
                <button
                  onClick={() => setShowGmailConnect(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 transition-all shadow-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 010 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/>
                  </svg>
                  Connect Gmail
                </button>
              )}
            </div>
          </div>

          {/* Gmail Connect Form */}
          {showGmailConnect && !gmailStatus?.connected && (
            <div className="border-t border-slate-200 pt-4 mt-2">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-amber-800">
                  <strong>Setup:</strong> You need a Google App Password. Go to{" "}
                  <span className="font-mono text-xs">myaccount.google.com/apppasswords</span>
                  {" "}(requires 2-Step Verification enabled) and create one for &quot;Mail&quot;.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Gmail Address</label>
                  <input
                    type="email"
                    value={gmailEmail}
                    onChange={(e) => setGmailEmail(e.target.value)}
                    placeholder="you@gmail.com"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">App Password</label>
                  <input
                    type="password"
                    value={gmailPassword}
                    onChange={(e) => setGmailPassword(e.target.value)}
                    placeholder="xxxx xxxx xxxx xxxx"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={handleGmailConnect}
                  disabled={gmailConnecting}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {gmailConnecting ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Connecting...
                    </>
                  ) : (
                    "Connect"
                  )}
                </button>
                <button
                  onClick={() => setShowGmailConnect(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Auto-Workflow Status */}
          {gmailStatus?.connected && gmailStatus.polling && (
            <div className="border-t border-slate-200 pt-4 mt-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-slate-700">Auto-Workflow Activity</h3>
                <span className="text-xs text-slate-500">
                  {gmailStatus.total_processed} emails processed
                  {gmailStatus.last_sync_at && (
                    <> &middot; Last sync: {timeAgo(gmailStatus.last_sync_at)}</>
                  )}
                </span>
              </div>
              {gmailStatus.recent_results.length > 0 ? (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {gmailStatus.recent_results.slice().reverse().map((r, i) => (
                    <div
                      key={i}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${
                        r.error
                          ? "bg-red-50 text-red-700"
                          : "bg-green-50 text-green-700"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {r.error ? (
                          <svg className="w-4 h-4 flex-shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                        <span className="truncate font-medium">
                          {r.subject || `Email #${r.email_id}`}
                        </span>
                        {r.from && (
                          <span className="text-slate-400 truncate">from {r.from}</span>
                        )}
                      </div>
                      <span className="text-slate-400 flex-shrink-0 ml-2">
                        {timeAgo(r.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">Waiting for new emails...</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Sample / Manual Actions ═══ */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-slate-500">Quick Actions:</span>
          <button
            onClick={handleConnect}
            disabled={connectLoading}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
          >
            {connectLoading ? "Loading..." : "Load Sample Inbox"}
          </button>
          <button
            onClick={handleClassify}
            disabled={classifyLoading}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 transition-colors"
          >
            {classifyLoading ? "Classifying..." : "Classify Emails"}
          </button>
          <button
            onClick={handleRunWorkflow}
            disabled={workflowLoading}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {workflowLoading ? "Running..." : "Run Auto-Workflow"}
          </button>
          {connectStatus && (
            <span className="text-xs text-slate-500">{connectStatus}</span>
          )}
        </div>
      </div>

      {/* ═══ Email List ═══ */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        {/* Filter Tabs */}
        <div className="border-b border-slate-200 px-6 pt-4">
          <div className="flex gap-1">
            {filterTabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => {
                  setFilter(tab.value);
                  setPage(1);
                }}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                  filter === tab.value
                    ? "bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-12 text-center">
            <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-slate-500">Loading emails...</p>
          </div>
        ) : emails.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="mx-auto h-12 w-12 text-slate-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <h3 className="text-sm font-medium text-slate-900 mb-1">No emails found</h3>
            <p className="text-sm text-slate-500">
              Connect Gmail or load sample data to get started.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">From</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Subject</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Date</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Classification</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Confidence</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {emails.map((email) => {
                  const classification = email.classified_as || "unknown";
                  const badgeClass = CLASSIFICATION_BADGES[classification] || CLASSIFICATION_BADGES.unknown;
                  const processed = email.processed;

                  return (
                    <tr key={email.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-slate-900">{email.from_name || "Unknown"}</div>
                        <div className="text-xs text-slate-500">{email.from_address}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-slate-900 max-w-xs truncate">{email.subject}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-slate-500">
                          {email.received_at ? timeAgo(email.received_at) : timeAgo(email.created_at)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${badgeClass}`}>
                          {classification === "candidate_application"
                            ? "Application"
                            : classification.charAt(0).toUpperCase() + classification.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {email.confidence !== null ? (
                          <span className="text-sm text-slate-700 font-medium">
                            {Math.round(email.confidence * 100)}%
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">--</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {processed >= 2 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Processed
                          </span>
                        ) : processed === 1 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                            Classified
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                            New
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {classification === "candidate_application" && processed < 2 && (
                          <button
                            onClick={() => handleCreateCandidate(email.id)}
                            disabled={creatingCandidate === email.id}
                            className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {creatingCandidate === email.id ? "Creating..." : "Create Candidate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3">
            <p className="text-sm text-slate-500">
              Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total} emails
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm font-medium rounded-md text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-sm text-slate-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm font-medium rounded-md text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
