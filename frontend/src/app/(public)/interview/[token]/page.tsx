"use client";

import { use, useState, useEffect, useRef, useCallback } from "react";
import { useConversation } from "@elevenlabs/react";

// ═══════════════════════════════════════
// Types
// ═══════════════════════════════════════

type InterviewPhase =
  | "loading"
  | "invalid"
  | "setup"
  | "ready"
  | "interviewing"
  | "completed";

interface InterviewData {
  token: string;
  status: string;
  candidate_first_name: string;
  job_title: string;
  company_name: string;
  elevenlabs_agent_id: string;
  is_valid: boolean;
  error: string | null;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// ═══════════════════════════════════════
// Main Component
// ═══════════════════════════════════════

export default function InterviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  // Phase state machine
  const [phase, setPhase] = useState<InterviewPhase>("loading");
  const [interviewData, setInterviewData] = useState<InterviewData | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Webcam
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Face detection
  const [faceDetected, setFaceDetected] = useState(false);
  const [attentionScore, setAttentionScore] = useState(0);
  const faceDetectorRef = useRef<unknown>(null);
  const detectionLoopRef = useRef<number | null>(null);
  const trackingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null
  );
  const latestFaceDataRef = useRef({
    face_present: false,
    attention_score: 0,
    face_count: 0,
  });

  // Interview timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Transcript accumulator
  const transcriptRef = useRef<string[]>([]);

  // ── ElevenLabs conversation hook ────────────────────────────────────────

  const conversation = useConversation({
    onConnect: () => {
      updateStatus("interview_started");
    },
    onDisconnect: () => {
      handleInterviewEnd();
    },
    onMessage: (message: { source: string; message: string }) => {
      const role = message.source === "ai" ? "Agent" : "Candidate";
      transcriptRef.current.push(
        `[${elapsedSeconds}s] ${role}: ${message.message}`
      );
    },
    onError: (error: unknown) => {
      console.error("ElevenLabs error:", error);
    },
  });

  // ── Token validation ────────────────────────────────────────────────────

  useEffect(() => {
    async function validateToken() {
      try {
        const res = await fetch(`${API_BASE}/screening/link/${token}`);
        const data: InterviewData = await res.json();
        setInterviewData(data);
        if (!data.is_valid) {
          setPhase("invalid");
          setErrorMsg(data.error || "Invalid interview link.");
        } else {
          setPhase("setup");
        }
      } catch {
        setPhase("invalid");
        setErrorMsg("Failed to validate interview link. Please try again.");
      }
    }
    validateToken();
  }, [token]);

  // ── Status update helper ────────────────────────────────────────────────

  const updateStatus = async (
    status: string,
    conversationId?: string
  ) => {
    try {
      await fetch(`${API_BASE}/screening/link/${token}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          elevenlabs_conversation_id: conversationId || null,
        }),
      });
    } catch {
      // Don't disrupt the interview
    }
  };

  // ── Webcam ──────────────────────────────────────────────────────────────

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
        setCameraError(null);
        // Init face detection after camera is ready
        initFaceDetection();
      }
    } catch {
      setCameraError(
        "Camera access is required for the interview. Please enable your webcam and reload."
      );
    }
  };

  // ── Face Detection (MediaPipe) ──────────────────────────────────────────

  const initFaceDetection = async () => {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      const detector = await vision.FaceDetector.createFromOptions(
        filesetResolver,
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
        }
      );
      faceDetectorRef.current = detector;
      startFaceDetectionLoop();
    } catch (err) {
      console.warn("Face detection init failed, continuing without it:", err);
    }
  };

  const detectFace = useCallback(() => {
    const detector = faceDetectorRef.current as {
      detectForVideo: (
        video: HTMLVideoElement,
        timestamp: number
      ) => {
        detections: Array<{
          boundingBox?: {
            originX: number;
            width: number;
            height: number;
          };
        }>;
      };
    } | null;
    if (!detector || !videoRef.current) return;

    try {
      const result = detector.detectForVideo(
        videoRef.current,
        performance.now()
      );
      const present = result.detections.length > 0;
      setFaceDetected(present);

      let score = 0;
      if (present && result.detections[0].boundingBox) {
        const bbox = result.detections[0].boundingBox;
        const faceArea = (bbox.width * bbox.height) / (640 * 480);
        const centerX = bbox.originX + bbox.width / 2;
        const centerOffset = Math.abs(centerX - 320) / 320;
        score = Math.min(1.0, faceArea * 10) * (1 - centerOffset * 0.5);
      }
      setAttentionScore(score);

      latestFaceDataRef.current = {
        face_present: present,
        attention_score: score,
        face_count: result.detections.length,
      };
    } catch {
      // Skip frame on error
    }
  }, []);

  const startFaceDetectionLoop = useCallback(() => {
    // Run at ~10fps via throttled setTimeout
    const throttled = () => {
      detectFace();
      detectionLoopRef.current = window.setTimeout(
        throttled,
        100
      ) as unknown as number;
    };
    throttled();
  }, [detectFace]);

  // ── Face tracking data submission ───────────────────────────────────────

  const startFaceTracking = useCallback(() => {
    trackingIntervalRef.current = setInterval(async () => {
      const data = latestFaceDataRef.current;
      try {
        await fetch(`${API_BASE}/screening/link/${token}/face-tracking`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            face_present: data.face_present,
            attention_score: data.attention_score,
            timestamp: Date.now(),
            face_count: data.face_count,
          }),
        });
      } catch {
        // Silently fail
      }
    }, 10000);
  }, [token]);

  // ── Start Interview ─────────────────────────────────────────────────────

  const startInterview = async () => {
    if (!interviewData?.elevenlabs_agent_id) {
      setErrorMsg("Interview agent not configured. Please contact the recruiter.");
      return;
    }

    try {
      await conversation.startSession({
        agentId: interviewData.elevenlabs_agent_id,
        connectionType: "websocket",
      });

      setPhase("interviewing");
      startFaceTracking();

      // Start timer
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Failed to start ElevenLabs session:", err);
      setErrorMsg(
        "Failed to start the interview. Please check your microphone permissions and try again."
      );
    }
  };

  // ── End Interview ───────────────────────────────────────────────────────

  const handleInterviewEnd = async () => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Stop face tracking
    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }

    // Stop face detection loop
    if (detectionLoopRef.current) {
      clearTimeout(detectionLoopRef.current);
      detectionLoopRef.current = null;
    }

    // Stop camera
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setPhase("completed");

    // Submit transcript
    const transcript = transcriptRef.current.join("\n");
    try {
      await fetch(`${API_BASE}/screening/link/${token}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcript || "[No transcript captured]",
          duration_seconds: elapsedSeconds,
        }),
      });
    } catch {
      console.error("Failed to submit transcript");
    }

    await updateStatus("interview_completed");
  };

  const endInterview = async () => {
    try {
      await conversation.endSession();
    } catch {
      // If endSession fails, handle end manually
      handleInterviewEnd();
    }
  };

  // ── Auto-advance from setup to ready when camera is enabled ────────────

  useEffect(() => {
    if (phase === "setup" && cameraReady) {
      setPhase("ready");
    }
  }, [phase, cameraReady]);

  // ── Cleanup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (trackingIntervalRef.current)
        clearInterval(trackingIntervalRef.current);
      if (detectionLoopRef.current) clearTimeout(detectionLoopRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ── Format time ─────────────────────────────────────────────────────────

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════

  // ── Loading ─────────────────────────────────────────────────────────────

  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-slate-500">Validating interview link...</p>
        </div>
      </div>
    );
  }

  // ── Invalid ─────────────────────────────────────────────────────────────

  if (phase === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-red-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              Interview Unavailable
            </h1>
            <p className="text-sm text-slate-500 leading-relaxed">
              {errorMsg || "This interview link is no longer valid."}
            </p>
            <p className="text-xs text-slate-400 mt-4">
              Please contact the recruiter if you believe this is an error.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Completed ───────────────────────────────────────────────────────────

  if (phase === "completed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-8 h-8 text-green-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              Interview Complete!
            </h1>
            <p className="text-sm text-slate-500 leading-relaxed">
              Thank you, {interviewData?.candidate_first_name}! Your interview
              for the{" "}
              <span className="font-medium text-slate-700">
                {interviewData?.job_title}
              </span>{" "}
              position has been recorded.
            </p>
            <p className="text-xs text-slate-400 mt-3">
              Duration: {formatTime(elapsedSeconds)}
            </p>
            <div className="mt-6 bg-slate-50 rounded-lg p-4 border border-slate-100">
              <p className="text-sm text-slate-600">
                Our team will review your interview and get back to you soon.
                You can close this page.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Setup / Ready / Interviewing ────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">H</span>
            </div>
            <span className="font-semibold text-slate-900">
              {interviewData?.company_name || "HireOps AI"}
            </span>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-slate-700">
              Interview for {interviewData?.job_title}
            </p>
            {phase === "interviewing" && (
              <p className="text-xs text-slate-500 tabular-nums">
                {formatTime(elapsedSeconds)}
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Welcome message in setup phase */}
        {(phase === "setup" || phase === "ready") && (
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Welcome, {interviewData?.candidate_first_name}!
            </h1>
            <p className="text-slate-500">
              {phase === "setup"
                ? "Please enable your webcam to proceed with the interview."
                : "Your camera is ready. Click Start Interview when you're ready to begin."}
            </p>
          </div>
        )}

        {/* Error banner */}
        {errorMsg && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Webcam */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                Your Camera
              </h2>
              <div className="flex items-center gap-2">
                {cameraReady && (
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                      faceDetected ? "text-green-600" : "text-yellow-600"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        faceDetected
                          ? "bg-green-500 animate-pulse"
                          : "bg-yellow-500"
                      }`}
                    />
                    {faceDetected ? "Face Detected" : "No Face"}
                  </span>
                )}
              </div>
            </div>
            <div className="relative aspect-[4/3] bg-slate-900">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <svg
                      className="w-16 h-16 text-slate-600 mx-auto mb-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
                      />
                    </svg>
                    <p className="text-sm text-slate-400">
                      Camera preview will appear here
                    </p>
                  </div>
                </div>
              )}
              {/* Attention indicator overlay */}
              {cameraReady && phase === "interviewing" && (
                <div className="absolute bottom-3 left-3 right-3 flex items-center gap-3">
                  <div className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-2">
                    <span className="text-xs text-white/70">Attention</span>
                    <div className="w-20 h-1.5 bg-white/20 rounded-full">
                      <div
                        className={`h-1.5 rounded-full transition-all ${
                          attentionScore > 0.6
                            ? "bg-green-400"
                            : attentionScore > 0.3
                            ? "bg-yellow-400"
                            : "bg-red-400"
                        }`}
                        style={{
                          width: `${Math.round(attentionScore * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-white font-medium tabular-nums">
                      {Math.round(attentionScore * 100)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
            {cameraError && (
              <div className="px-5 py-3 bg-red-50 text-sm text-red-600">
                {cameraError}
              </div>
            )}
          </div>

          {/* Right: Interview agent / controls */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                AI Interviewer
              </h2>
              {phase === "interviewing" && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600">
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Live
                </span>
              )}
            </div>
            <div className="p-6 flex flex-col items-center justify-center min-h-[300px]">
              {/* Setup phase */}
              {phase === "setup" && (
                <div className="text-center space-y-6">
                  <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto">
                    <svg
                      className="w-10 h-10 text-indigo-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-1">
                      Enable Your Camera
                    </h3>
                    <p className="text-sm text-slate-500 max-w-sm">
                      We need camera access to verify your identity during the
                      interview. Your webcam feed is not recorded.
                    </p>
                  </div>
                  <button
                    onClick={startCamera}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-medium shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 transition-all"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
                      />
                    </svg>
                    Enable Camera
                  </button>
                  {cameraReady && (
                    <button
                      onClick={() => setPhase("ready")}
                      className="block mx-auto text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      Camera enabled — Continue
                    </button>
                  )}
                </div>
              )}

              {/* Ready phase */}
              {phase === "ready" && (
                <div className="text-center space-y-6">
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <svg
                      className="w-10 h-10 text-green-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-1">
                      Ready to Begin
                    </h3>
                    <p className="text-sm text-slate-500 max-w-sm">
                      You&apos;ll speak with our AI interviewer about the{" "}
                      <span className="font-medium text-slate-700">
                        {interviewData?.job_title}
                      </span>{" "}
                      position. Make sure your microphone is working.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <button
                      onClick={startInterview}
                      className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl font-semibold text-lg shadow-lg shadow-green-200 hover:shadow-xl hover:shadow-green-300 transition-all"
                    >
                      <svg
                        className="w-6 h-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                        />
                      </svg>
                      Start Interview
                    </button>
                    <p className="text-xs text-slate-400">
                      Your browser will ask for microphone access
                    </p>
                  </div>
                </div>
              )}

              {/* Interviewing phase */}
              {phase === "interviewing" && (
                <div className="text-center space-y-6 w-full">
                  {/* Animated waveform indicator */}
                  <div className="flex items-center justify-center gap-1 h-16">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={i}
                        className="w-2 bg-indigo-500 rounded-full animate-pulse"
                        style={{
                          height: `${20 + Math.random() * 40}px`,
                          animationDelay: `${i * 0.15}s`,
                          animationDuration: "0.8s",
                        }}
                      />
                    ))}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-1">
                      Interview in Progress
                    </h3>
                    <p className="text-sm text-slate-500">
                      Speak naturally. The AI interviewer is listening and will
                      respond.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-6 text-sm">
                    <div className="flex items-center gap-2 text-slate-500">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                        />
                      </svg>
                      <span className="tabular-nums font-medium">
                        {formatTime(elapsedSeconds)}
                      </span>
                    </div>
                    <div
                      className={`flex items-center gap-2 ${
                        faceDetected ? "text-green-600" : "text-yellow-600"
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          faceDetected ? "bg-green-500" : "bg-yellow-500"
                        }`}
                      />
                      {faceDetected ? "Face visible" : "Face not visible"}
                    </div>
                  </div>
                  <button
                    onClick={endInterview}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                    End Interview
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Instructions footer */}
        {(phase === "setup" || phase === "ready") && (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                icon: "camera",
                title: "Camera Required",
                desc: "Keep your webcam on throughout the interview",
              },
              {
                icon: "mic",
                title: "Microphone Required",
                desc: "Speak clearly and ensure your mic is working",
              },
              {
                icon: "clock",
                title: "10-15 Minutes",
                desc: "The interview typically takes 10-15 minutes",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="bg-white rounded-xl border border-slate-200 p-4 text-center"
              >
                <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center mx-auto mb-2">
                  {item.icon === "camera" && (
                    <svg
                      className="w-5 h-5 text-indigo-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
                      />
                    </svg>
                  )}
                  {item.icon === "mic" && (
                    <svg
                      className="w-5 h-5 text-indigo-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
                      />
                    </svg>
                  )}
                  {item.icon === "clock" && (
                    <svg
                      className="w-5 h-5 text-indigo-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                      />
                    </svg>
                  )}
                </div>
                <h3 className="text-sm font-semibold text-slate-700">
                  {item.title}
                </h3>
                <p className="text-xs text-slate-500 mt-1">{item.desc}</p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
