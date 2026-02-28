export const PIPELINE_STAGES = [
  "new",
  "classified",
  "matched",
  "screening_scheduled",
  "screened",
  "shortlisted",
  "rejected",
] as const;

export const STAGE_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  classified: "bg-indigo-100 text-indigo-800",
  matched: "bg-purple-100 text-purple-800",
  screening_scheduled: "bg-yellow-100 text-yellow-800",
  screened: "bg-orange-100 text-orange-800",
  shortlisted: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export const STAGE_LABELS: Record<string, string> = {
  new: "New",
  classified: "Classified",
  matched: "Matched",
  screening_scheduled: "Screening",
  screened: "Screened",
  shortlisted: "Shortlisted",
  rejected: "Rejected",
};

export const SENIORITY_OPTIONS = ["junior", "mid", "senior", "lead"];

export const RECOMMENDATION_COLORS: Record<string, string> = {
  advance: "bg-green-100 text-green-800",
  hold: "bg-yellow-100 text-yellow-800",
  reject: "bg-red-100 text-red-800",
};

export function scoreColor(score: number | null): string {
  if (score === null) return "text-gray-400";
  if (score >= 70) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
}

export function scoreBg(score: number | null): string {
  if (score === null) return "bg-gray-100";
  if (score >= 70) return "bg-green-50";
  if (score >= 50) return "bg-yellow-50";
  return "bg-red-50";
}

export function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
