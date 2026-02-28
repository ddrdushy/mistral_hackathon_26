"use client";

import React from "react";
import {
  ChevronUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  InboxIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  width?: string;
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  total: number;
  page: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onSort?: (key: string, order: "asc" | "desc") => void;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}

/* ------------------------------------------------------------------ */
/*  Skeleton loader for the loading state                             */
/* ------------------------------------------------------------------ */
function SkeletonRows({ columns, rows }: { columns: number; rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <tr key={rowIdx} className="border-b border-slate-100">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <td key={colIdx} className="px-4 py-3.5">
              <div
                className="h-4 bg-slate-200 rounded animate-pulse"
                style={{ width: `${55 + ((rowIdx + colIdx) % 4) * 12}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Sort icon for column headers                                      */
/* ------------------------------------------------------------------ */
function SortIcon({
  columnKey,
  sortBy,
  sortOrder,
}: {
  columnKey: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  if (sortBy !== columnKey) {
    return <ChevronUpDownIcon className="h-4 w-4 text-slate-400" />;
  }
  return sortOrder === "asc" ? (
    <ChevronUpIcon className="h-4 w-4 text-blue-600" />
  ) : (
    <ChevronDownIcon className="h-4 w-4 text-blue-600" />
  );
}

/* ------------------------------------------------------------------ */
/*  Pagination controls                                               */
/* ------------------------------------------------------------------ */
function Pagination({
  page,
  perPage,
  total,
  onPageChange,
}: {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start = Math.min((page - 1) * perPage + 1, total);
  const end = Math.min(page * perPage, total);

  /* Build a compact page-number list with ellipsis */
  function getPageNumbers(): (number | "ellipsis")[] {
    const pages: (number | "ellipsis")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push("ellipsis");
      for (
        let i = Math.max(2, page - 1);
        i <= Math.min(totalPages - 1, page + 1);
        i++
      ) {
        pages.push(i);
      }
      if (page < totalPages - 2) pages.push("ellipsis");
      pages.push(totalPages);
    }
    return pages;
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
      <p className="text-sm text-slate-500">
        Showing{" "}
        <span className="font-medium text-slate-700">{start}</span>
        {" - "}
        <span className="font-medium text-slate-700">{end}</span>
        {" of "}
        <span className="font-medium text-slate-700">{total}</span>
      </p>

      <nav className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>

        {getPageNumbers().map((p, i) =>
          p === "ellipsis" ? (
            <span
              key={`ellipsis-${i}`}
              className="inline-flex items-center justify-center h-8 w-8 text-sm text-slate-400"
            >
              ...
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`inline-flex items-center justify-center h-8 w-8 rounded-md text-sm font-medium transition-colors ${
                p === page
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {p}
            </button>
          ),
        )}

        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Next page"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main DataTable component                                          */
/* ------------------------------------------------------------------ */
export default function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  total,
  page,
  perPage,
  onPageChange,
  onSort,
  sortBy,
  sortOrder,
  loading = false,
  emptyMessage = "No results found",
  onRowClick,
}: DataTableProps<T>) {
  function handleSort(key: string) {
    if (!onSort) return;
    const newOrder =
      sortBy === key && sortOrder === "asc" ? "desc" : "asc";
    onSort(key, newOrder);
  }

  /* Accessor that supports dot-notation keys like "user.name" */
  function getCellValue(row: T, key: string): unknown {
    return key
      .split(".")
      .reduce<unknown>(
        (obj, k) =>
          obj && typeof obj === "object" ? (obj as Record<string, unknown>)[k] : undefined,
        row,
      );
  }

  const showEmpty = !loading && data.length === 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Scrollable wrapper for mobile */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">
          {/* ---- HEADER ---- */}
          <thead className="bg-slate-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 ${
                    col.sortable ? "cursor-pointer select-none" : ""
                  }`}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      <SortIcon
                        columnKey={col.key}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          {/* ---- BODY ---- */}
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <SkeletonRows columns={columns.length} rows={6} />
            )}

            {showEmpty && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-20 text-center"
                >
                  <div className="flex flex-col items-center gap-2">
                    <InboxIcon className="h-10 w-10 text-slate-300" />
                    <p className="text-sm text-slate-500">{emptyMessage}</p>
                  </div>
                </td>
              </tr>
            )}

            {!loading &&
              data.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  onClick={() => onRowClick?.(row)}
                  className={`
                    ${rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}
                    hover:bg-blue-50/40 transition-colors
                    ${onRowClick ? "cursor-pointer" : ""}
                  `}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className="px-4 py-3.5 text-sm text-slate-700 whitespace-nowrap"
                    >
                      {col.render
                        ? col.render(row)
                        : (getCellValue(row, col.key) as React.ReactNode) ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* ---- PAGINATION ---- */}
      {!loading && total > 0 && (
        <Pagination
          page={page}
          perPage={perPage}
          total={total}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}
