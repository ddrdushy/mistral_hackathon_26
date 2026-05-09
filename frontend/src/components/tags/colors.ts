// Shared palette + Tailwind class lookups for hand-applied tags.
// Backend stores the palette key (e.g. "indigo"); frontend renders the
// matching Tailwind classes. Adding a new colour means: append the key
// in backend/routers/tags.py:ALLOWED_COLORS AND add a row here.

export const TAG_PALETTE: { key: string; label: string }[] = [
  { key: "indigo", label: "Indigo" },
  { key: "blue", label: "Blue" },
  { key: "sky", label: "Sky" },
  { key: "cyan", label: "Cyan" },
  { key: "teal", label: "Teal" },
  { key: "emerald", label: "Emerald" },
  { key: "lime", label: "Lime" },
  { key: "yellow", label: "Yellow" },
  { key: "amber", label: "Amber" },
  { key: "orange", label: "Orange" },
  { key: "red", label: "Red" },
  { key: "rose", label: "Rose" },
  { key: "pink", label: "Pink" },
  { key: "fuchsia", label: "Fuchsia" },
  { key: "purple", label: "Purple" },
  { key: "violet", label: "Violet" },
  { key: "slate", label: "Slate" },
];

export const CHIP_CLASSES: Record<string, string> = {
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  lime: "bg-lime-50 text-lime-800 border-lime-200",
  yellow: "bg-yellow-50 text-yellow-800 border-yellow-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  red: "bg-red-50 text-red-700 border-red-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
  pink: "bg-pink-50 text-pink-700 border-pink-200",
  fuchsia: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  purple: "bg-purple-50 text-purple-700 border-purple-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
};

export const SWATCH_CLASSES: Record<string, string> = {
  indigo: "bg-indigo-500",
  blue: "bg-blue-500",
  sky: "bg-sky-500",
  cyan: "bg-cyan-500",
  teal: "bg-teal-500",
  emerald: "bg-emerald-500",
  lime: "bg-lime-500",
  yellow: "bg-yellow-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  rose: "bg-rose-500",
  pink: "bg-pink-500",
  fuchsia: "bg-fuchsia-500",
  purple: "bg-purple-500",
  violet: "bg-violet-500",
  slate: "bg-slate-500",
};

export function chipClass(color?: string): string {
  return CHIP_CLASSES[color || "indigo"] || CHIP_CLASSES.indigo;
}

export function swatchClass(color?: string): string {
  return SWATCH_CLASSES[color || "indigo"] || SWATCH_CLASSES.indigo;
}
