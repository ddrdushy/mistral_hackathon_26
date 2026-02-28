"use client";

import React from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}

export default function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  className = "",
}: SelectProps) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="
            block w-full appearance-none rounded-lg border border-slate-300
            bg-white px-3.5 py-2 pr-10 text-sm text-slate-900
            shadow-sm transition-colors
            placeholder:text-slate-400
            focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
            disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed
          "
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
          <ChevronDownIcon className="h-4 w-4 text-slate-400" />
        </div>
      </div>
    </div>
  );
}
