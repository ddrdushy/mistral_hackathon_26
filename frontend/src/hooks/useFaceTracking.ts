"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Webcam + MediaPipe face detection + periodic POST to the face-tracking
 * endpoint for the given interview token.
 *
 * Returns:
 *  - `videoRef` to attach to a <video>
 *  - `state` ({ ready, error, facePresent, attentionScore })
 *  - `start` — request camera + start detection + start posting
 *  - `stop`  — release camera and clear timers
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "/api/v1";

type FaceDetector = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => {
    detections: Array<{
      boundingBox?: { originX: number; width: number; height: number };
    }>;
  };
};

interface FaceTrackingState {
  ready: boolean;
  error: string | null;
  facePresent: boolean;
  attentionScore: number;
}

export function useFaceTracking(token: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const detectionLoopRef = useRef<number | null>(null);
  const trackingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestFaceDataRef = useRef({
    face_present: false,
    attention_score: 0,
    face_count: 0,
  });

  const [state, setState] = useState<FaceTrackingState>({
    ready: false,
    error: null,
    facePresent: false,
    attentionScore: 0,
  });

  const detectFace = useCallback(() => {
    const detector = detectorRef.current;
    const video = videoRef.current;
    if (!detector || !video) return;
    // MediaPipe throws RET_CHECK if videoWidth/Height is 0 — happens briefly
    // when the <video> first mounts / re-mounts before frames arrive.
    if (
      video.readyState < 2 ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return;
    }
    try {
      const result = detector.detectForVideo(video, performance.now());
      const present = result.detections.length > 0;
      let score = 0;
      if (present && result.detections[0].boundingBox) {
        const bbox = result.detections[0].boundingBox;
        const faceArea = (bbox.width * bbox.height) / (640 * 480);
        const centerX = bbox.originX + bbox.width / 2;
        const centerOffset = Math.abs(centerX - 320) / 320;
        score = Math.min(1.0, faceArea * 10) * (1 - centerOffset * 0.5);
      }
      latestFaceDataRef.current = {
        face_present: present,
        attention_score: score,
        face_count: result.detections.length,
      };
      setState((prev) => ({
        ...prev,
        facePresent: present,
        attentionScore: score,
      }));
    } catch {
      // skip frame
    }
  }, []);

  const startDetectionLoop = useCallback(() => {
    const tick = () => {
      detectFace();
      detectionLoopRef.current = window.setTimeout(
        tick,
        100,
      ) as unknown as number;
    };
    tick();
  }, [detectFace]);

  const initDetector = useCallback(async () => {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const filesetResolver = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
      );
      detectorRef.current = (await vision.FaceDetector.createFromOptions(
        filesetResolver,
        {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
        },
      )) as unknown as FaceDetector;
      startDetectionLoop();
    } catch (err) {
      console.warn("Face detector init failed:", err);
    }
  }, [startDetectionLoop]);

  const startUploader = useCallback(() => {
    if (trackingIntervalRef.current) return;
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
        // silent
      }
    }, 10000);
  }, [token]);

  const start = useCallback(async () => {
    if (state.ready) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState((prev) => ({ ...prev, ready: true, error: null }));
      await initDetector();
      startUploader();
    } catch {
      setState((prev) => ({
        ...prev,
        ready: false,
        error:
          "Camera access is required for the interview. Please enable your webcam and try again.",
      }));
    }
  }, [state.ready, initDetector, startUploader]);

  const stop = useCallback(() => {
    if (detectionLoopRef.current) {
      clearTimeout(detectionLoopRef.current);
      detectionLoopRef.current = null;
    }
    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { videoRef, state, start, stop };
}
