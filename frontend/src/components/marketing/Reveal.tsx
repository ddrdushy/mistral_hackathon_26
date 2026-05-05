"use client";

import { useEffect, useRef, useState, ReactNode } from "react";

type Direction = "up" | "left" | "right" | "scale";

interface RevealProps {
  children: ReactNode;
  delay?: number;          // ms
  duration?: number;       // ms
  direction?: Direction;
  threshold?: number;      // 0-1, viewport-intersection ratio to trigger
  className?: string;
  as?: "div" | "section" | "article" | "li";
  once?: boolean;
}

const HIDDEN: Record<Direction, string> = {
  up: "opacity-0 translate-y-8",
  left: "opacity-0 -translate-x-8",
  right: "opacity-0 translate-x-8",
  scale: "opacity-0 scale-[0.96]",
};

/**
 * Fade + slide content into view as it enters the viewport.
 * Stagger children by passing different delays.
 *
 * Uses IntersectionObserver — no scroll-listener thrash. Honours
 * prefers-reduced-motion via globals.css (which zeroes out animation/transition
 * for that media query on .motion-element). On the server it renders in the
 * "shown" state so SSR HTML is meaningful when JS is disabled.
 */
export default function Reveal({
  children,
  delay = 0,
  duration = 700,
  direction = "up",
  threshold = 0.15,
  className = "",
  as = "div",
  once = true,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  // Start "shown" so SSR renders content visibly; flip to hidden after mount,
  // then back to shown on intersection. Avoids FOUC where the section is
  // permanently invisible if JS hasn't loaded.
  const [hydrated, setHydrated] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Sync check first: if already in viewport at mount, mark visible
    // immediately and skip the observer — avoids flash-of-hidden for any
    // content above the fold (or already scrolled past).
    const rect = node.getBoundingClientRect();
    const vh = window.innerHeight;
    const alreadyInView = rect.top < vh * (1 - threshold) && rect.bottom > 0;
    if (alreadyInView) {
      setHydrated(true);
      setVisible(true);
      return;
    }

    setHydrated(true);
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) obs.disconnect();
          } else if (!once) {
            setVisible(false);
          }
        }
      },
      { threshold, rootMargin: "0px 0px -40px 0px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [threshold, once]);

  const Tag = as as keyof JSX.IntrinsicElements;
  const showState = !hydrated || visible;

  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      style={{
        transitionDelay: `${delay}ms`,
        transitionDuration: `${duration}ms`,
        willChange: "opacity, transform",
      }}
      className={`motion-element transition-[opacity,transform] ease-out ${
        showState ? "opacity-100 translate-x-0 translate-y-0 scale-100" : HIDDEN[direction]
      } ${className}`}
    >
      {children}
    </Tag>
  );
}
