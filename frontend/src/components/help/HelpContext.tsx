"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import HelpDrawer from "./HelpDrawer";
import { resolveHelp } from "@/lib/help/registry";
import type { HelpEntry } from "@/lib/help/types";

/**
 * Single drawer for the whole authenticated app. Multiple triggers
 * (the Topbar `?` icon, the floating bottom-right button, anything
 * else we add later) all dispatch through this context so the drawer
 * keeps a single state machine instead of fighting itself.
 */
interface HelpContextValue {
  open: (override?: HelpEntry) => void;
  close: () => void;
  isOpen: boolean;
  /** Current entry the drawer would show — useful for tooltips on triggers. */
  entry: HelpEntry;
}

const HelpCtx = createContext<HelpContextValue | null>(null);

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "";
  const routeEntry = resolveHelp(pathname);

  const [isOpen, setIsOpen] = useState(false);
  // When a caller passes an explicit override we use that instead of
  // the route-derived entry — handy for cards / modals that want to
  // teach a specific concept independent of the current URL.
  const [override, setOverride] = useState<HelpEntry | null>(null);

  const open = useCallback((maybe?: HelpEntry) => {
    setOverride(maybe || null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setOverride(null);
  }, []);

  const entry = override || routeEntry;

  const value = useMemo<HelpContextValue>(
    () => ({ open, close, isOpen, entry }),
    [open, close, isOpen, entry],
  );

  return (
    <HelpCtx.Provider value={value}>
      {children}
      <HelpDrawer open={isOpen} onClose={close} entry={entry} />
    </HelpCtx.Provider>
  );
}

export function useHelp(): HelpContextValue {
  const ctx = useContext(HelpCtx);
  if (!ctx) {
    // Defensive — calling useHelp outside a HelpProvider returns no-ops
    // so a stray trigger doesn't crash a marketing / signup page.
    return {
      open: () => {},
      close: () => {},
      isOpen: false,
      entry: resolveHelp(""),
    };
  }
  return ctx;
}
