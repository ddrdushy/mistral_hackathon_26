/**
 * Contextual help system. Every page in the app maps to a `HelpEntry`
 * via path pattern matching (see ./registry.ts). The Topbar's help
 * button opens a drawer that renders the matching entry.
 *
 * Content is intentionally structured (not free-form markdown) so the
 * drawer can present each section consistently and so links / role
 * gates can be enforced.
 */

export interface HelpStep {
  /** Imperative one-liner — "Click 'Generate Offer' on the candidate page." */
  text: string;
  /** Optional sub-text or example, rendered smaller below the step. */
  detail?: string;
}

export interface HelpLink {
  href: string;
  label: string;
  /** "internal" links open in same tab (Next router), "external" in a new tab. */
  kind?: "internal" | "external";
}

export interface HelpEntry {
  /** Drawer title — usually the page name, not the route. */
  title: string;
  /** 1-2 sentences answering "what is this?" */
  what: string;
  /** Optional 3-5 bullets of why-it-matters / capabilities. */
  highlights?: string[];
  /** Click-by-click "how to use" steps. */
  howToUse: HelpStep[];
  /** Optional configuration steps. Hidden if absent. */
  howToConfigure?: HelpStep[];
  /** Optional gotchas / tips, plain bullets. */
  tips?: string[];
  /** Deep links to docs, related pages, external resources. */
  learnMore?: HelpLink[];
  /** When true, drawer prepends a "Owner / admin action" warning. */
  ownerOnly?: boolean;
  /** When true, drawer prepends a "Super-admin action" warning. */
  superAdminOnly?: boolean;
}
