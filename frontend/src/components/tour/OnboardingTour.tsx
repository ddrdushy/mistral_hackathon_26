"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Joyride, type EventData, type Step } from "react-joyride";
import { tourEvents } from "./tourEvents";

const STORAGE_KEY = "hireops:tour-completed:v1";

interface TourStep extends Step {
  route?: string;
}

const STEPS: TourStep[] = [
  {
    target: "body",
    placement: "center",
    title: "Welcome to HireOps AI",
    content:
      "60-second tour. Skip anytime, replay later from the Help button (?) in the top bar.",
  },
  {
    target: '[data-tour="sidebar"]',
    placement: "right",
    title: "Navigation",
    content:
      "Inbox processes incoming applications. Jobs hosts your openings. Candidates is the pipeline. Reports is your analytics.",
  },
  {
    target: '[data-tour="kpi-cards"]',
    placement: "bottom",
    title: "Live KPIs",
    content:
      "At-a-glance metrics: total applications, average resume score, active screenings, and shortlist conversion.",
    route: "/dashboard",
  },
  {
    target: '[data-tour="pipeline-funnel"]',
    placement: "top",
    title: "Pipeline funnel",
    content:
      "Stage-by-stage breakdown of every application. Hover any bar for percentages.",
  },
  {
    target: '[data-tour="decisions-donut"]',
    placement: "left",
    title: "Decisions at a glance",
    content:
      "Outcome split: shortlisted, in-progress, rejected. Conversion and rejection rates underneath.",
  },
  {
    target: '[data-tour="top-candidates"]',
    placement: "top",
    title: "Top candidates",
    content:
      "Highest-scoring candidates across all jobs. Click any row to open the full profile with score gauges and integrity signals.",
  },
  {
    target: '[data-tour="needs-action"]',
    placement: "left",
    title: "Needs HR action",
    content:
      "Candidates flagged HOLD by the AI — they need a human decision. The count tells you how much is waiting.",
  },
  {
    target: '[data-tour="quick-actions"]',
    placement: "top",
    title: "Quick actions",
    content:
      "Sync the inbox, post a new job (with AI auto-fill), or jump to the candidate list. That's the tour — happy hiring!",
  },
];

export default function OnboardingTour() {
  const router = useRouter();
  const pathname = usePathname();
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const pendingRouteRef = useRef<string | null>(null);

  // Hydration guard: only render the tour after mount, never during SSR
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-start for fresh users
  useEffect(() => {
    if (!mounted) return;
    if (!localStorage.getItem(STORAGE_KEY)) {
      const t = setTimeout(() => setRun(true), 600);
      return () => clearTimeout(t);
    }
  }, [mounted]);

  // Listen for "restart" events from the Help button
  useEffect(() => {
    const handleStart = () => {
      setStepIndex(0);
      setRun(true);
    };
    tourEvents.addEventListener("start", handleStart);
    return () => tourEvents.removeEventListener("start", handleStart);
  }, []);

  // After route changes (when a step requires it), give the page a beat to render
  useEffect(() => {
    if (pendingRouteRef.current && pathname === pendingRouteRef.current) {
      pendingRouteRef.current = null;
      const t = setTimeout(() => setRun(true), 400);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  const handleCallback = useCallback(
    (data: EventData) => {
      const { status, type, action, index } = data;
      const finished =
        status === "finished" || status === "skipped";

      if (finished) {
        localStorage.setItem(STORAGE_KEY, "1");
        setRun(false);
        setStepIndex(0);
        return;
      }

      if (type === "step:after" && action !== "close") {
        const nextIndex = action === "prev" ? index - 1 : index + 1;
        const nextStep = STEPS[nextIndex];
        if (nextStep?.route && pathname !== nextStep.route) {
          setRun(false);
          pendingRouteRef.current = nextStep.route;
          setStepIndex(nextIndex);
          router.push(nextStep.route);
          return;
        }
        setStepIndex(nextIndex);
      }

      if (type === "tour:end") {
        localStorage.setItem(STORAGE_KEY, "1");
        setRun(false);
      }
    },
    [pathname, router],
  );

  if (!mounted) return null;

  return (
    <Joyride
      steps={STEPS as Step[]}
      run={run}
      stepIndex={stepIndex}
      onEvent={handleCallback}
      continuous
      scrollToFirstStep
      options={{
        primaryColor: "#4f46e5",
        zIndex: 10000,
        backgroundColor: "#ffffff",
        textColor: "#0f172a",
        overlayColor: "rgba(15, 23, 42, 0.55)",
        arrowColor: "#ffffff",
        showProgress: true,
        buttons: ["back", "primary", "skip"],
      }}
      styles={{
        tooltip: {
          borderRadius: 12,
          padding: 18,
        },
        tooltipTitle: {
          fontSize: 16,
          fontWeight: 700,
        },
        tooltipContent: {
          fontSize: 13,
          lineHeight: 1.5,
          paddingTop: 8,
        },
        buttonPrimary: {
          fontSize: 13,
          padding: "8px 14px",
          borderRadius: 8,
        },
        buttonBack: {
          fontSize: 13,
        },
        buttonSkip: {
          fontSize: 12,
          color: "#64748b",
        },
      }}
      locale={{
        back: "Back",
        close: "Close",
        last: "Finish",
        next: "Next",
        skip: "Skip",
      }}
    />
  );
}
