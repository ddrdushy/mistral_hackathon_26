/**
 * Tiny pub-sub used by the Help button (in Topbar) to ask OnboardingTour
 * to restart. Keeps the two components decoupled so they don't have to
 * share state via context.
 */
export const tourEvents =
  typeof window === "undefined"
    ? ({
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      } as unknown as EventTarget)
    : new EventTarget();

export function startTour() {
  tourEvents.dispatchEvent(new Event("start"));
}
