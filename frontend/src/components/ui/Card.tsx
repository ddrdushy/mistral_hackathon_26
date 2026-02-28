"use client";

import React from "react";

interface CardProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
  action?: React.ReactNode;
}

export default function Card({
  children,
  title,
  className = "",
  action,
}: CardProps) {
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}
    >
      {title && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {action && <div className="flex items-center">{action}</div>}
        </div>
      )}
      <div className={title ? "px-6 py-4" : "p-6"}>{children}</div>
    </div>
  );
}
