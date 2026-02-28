"use client";

import React from "react";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";
type BadgeSize = "sm" | "md";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const variantStyles: Record<BadgeVariant, string> = {
  default:
    "bg-slate-100 text-slate-700 ring-slate-200",
  success:
    "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning:
    "bg-amber-50 text-amber-700 ring-amber-200",
  danger:
    "bg-red-50 text-red-700 ring-red-200",
  info:
    "bg-blue-50 text-blue-700 ring-blue-200",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
};

export default function Badge({
  children,
  variant = "default",
  size = "md",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ring-1 ring-inset whitespace-nowrap ${variantStyles[variant]} ${sizeStyles[size]}`}
    >
      {children}
    </span>
  );
}
