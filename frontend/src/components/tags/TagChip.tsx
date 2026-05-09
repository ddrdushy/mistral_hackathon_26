"use client";

import { XMarkIcon } from "@heroicons/react/24/outline";
import { chipClass } from "./colors";

export interface TagSummary {
  id: number;
  name: string;
  color?: string;
}

export default function TagChip({
  tag,
  onRemove,
  size = "sm",
}: {
  tag: TagSummary;
  onRemove?: () => void;
  size?: "sm" | "xs";
}) {
  const sizeClass =
    size === "xs"
      ? "text-[11px] px-1.5 py-0.5"
      : "text-xs px-2 py-0.5";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${sizeClass} ${chipClass(
        tag.color,
      )}`}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 -mr-0.5 hover:bg-white/40 rounded-full p-0.5"
          aria-label={`Remove ${tag.name}`}
        >
          <XMarkIcon className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
