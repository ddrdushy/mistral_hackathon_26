"use client";

import { useEffect, useState } from "react";
import {
  VideoCameraIcon,
  ShieldCheckIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";

/**
 * Candidate-side meeting room for the "hr_video" interview mode. We
 * embed a Jitsi Meet room keyed off the interview token, so both the
 * candidate (this page) and the HR user (button on /candidates/:id)
 * land in the same room without any third-party signup.
 *
 * The room name is derived from the token so it's effectively
 * unguessable. We don't proxy a TURN server or self-host Jitsi — for
 * v1 we use meet.jit.si, which is fine for a 1-on-1 interview but
 * means the call is unrecorded by default. When we want HR-side
 * recording we'll need to either self-host or upgrade to Jaas Cloud.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api/v1";

function roomName(token: string): string {
  return `hireops-interview-${token.slice(0, 16)}`;
}

export default function HrVideoRoom({
  token,
  candidateFirstName,
  jobTitle,
  companyName,
  onComplete,
}: {
  token: string;
  candidateFirstName: string;
  jobTitle: string;
  companyName: string;
  onComplete: () => void;
}) {
  const [joined, setJoined] = useState(false);

  // Tell the backend the candidate opened the link, just like the
  // voice/qa flows do.
  useEffect(() => {
    fetch(`${API_BASE}/screening/link/${token}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "opened" }),
    }).catch(() => {});
  }, [token]);

  const handleJoin = async () => {
    setJoined(true);
    try {
      await fetch(`${API_BASE}/screening/link/${token}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "interview_started" }),
      });
    } catch {
      // non-fatal
    }
  };

  const handleEnd = async () => {
    try {
      await fetch(`${API_BASE}/screening/link/${token}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "interview_completed" }),
      });
    } catch {
      // non-fatal
    }
    onComplete();
  };

  if (!joined) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
          <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 mb-4">
            <VideoCameraIcon className="w-7 h-7" />
          </span>
          <h1 className="text-2xl font-bold text-slate-900">
            Hi {candidateFirstName} — ready to meet the team?
          </h1>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            You&apos;ve been invited to a live video interview for the{" "}
            <strong>{jobTitle}</strong> role at <strong>{companyName}</strong>.
            A recruiter will join you in this room.
          </p>

          <div className="mt-5 rounded-lg bg-slate-50 border border-slate-200 p-4 text-left text-xs text-slate-600 space-y-2">
            <p className="flex items-start gap-2">
              <ShieldCheckIcon className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <span>
                Find a quiet space with good lighting and a stable internet
                connection.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <ShieldCheckIcon className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <span>
                Your browser will ask for camera and microphone permission —
                please allow both.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <ShieldCheckIcon className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <span>
                If the recruiter hasn&apos;t joined yet, you&apos;ll see a
                waiting screen — that&apos;s normal.
              </span>
            </p>
          </div>

          <button
            onClick={handleJoin}
            className="mt-6 w-full px-5 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold"
          >
            Join interview room
          </button>
        </div>
      </div>
    );
  }

  const room = roomName(token);
  const displayName = encodeURIComponent(candidateFirstName);
  const jitsiUrl =
    `https://meet.jit.si/${room}` +
    `#userInfo.displayName="${displayName}"` +
    `&config.prejoinPageEnabled=false` +
    `&config.startWithAudioMuted=false` +
    `&config.startWithVideoMuted=false`;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="px-4 py-2 flex items-center justify-between text-white text-sm bg-slate-900">
        <div className="flex items-center gap-2">
          <VideoCameraIcon className="w-4 h-4" />
          <span className="font-medium">
            {companyName} — {jobTitle}
          </span>
        </div>
        <button
          onClick={handleEnd}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-700"
        >
          <ArrowUturnLeftIcon className="w-3.5 h-3.5" />
          Leave interview
        </button>
      </div>
      <iframe
        src={jitsiUrl}
        allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
        className="flex-1 w-full border-0"
        title="HR video interview"
      />
    </div>
  );
}
