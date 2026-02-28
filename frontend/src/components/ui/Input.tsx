"use client";

import React from "react";

interface InputProps {
  label?: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  icon?: React.ReactNode;
}

export default function Input({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  className = "",
  icon,
}: InputProps) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <span className="h-5 w-5 text-slate-400">{icon}</span>
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`
            block w-full rounded-lg border border-slate-300
            bg-white text-sm text-slate-900 shadow-sm
            transition-colors
            placeholder:text-slate-400
            focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
            disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed
            ${icon ? "pl-10" : "px-3.5"} py-2 pr-3.5
          `}
        />
      </div>
    </div>
  );
}
