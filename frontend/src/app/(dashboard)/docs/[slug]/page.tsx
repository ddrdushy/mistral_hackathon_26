"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import DocsLayout from "@/components/docs/DocsLayout";
import { SECTIONS } from "@/components/docs/sections";
import { findDoc, DOCS } from "@/lib/docs/registry";

export default function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const doc = findDoc(slug);
  const Section = SECTIONS[slug];
  if (!doc || !Section) {
    notFound();
  }

  const idx = DOCS.findIndex((d) => d.slug === slug);
  const prev = idx > 0 ? DOCS[idx - 1] : null;
  const next = idx < DOCS.length - 1 ? DOCS[idx + 1] : null;

  return (
    <DocsLayout>
      <Link
        href="/docs"
        className="not-prose inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        All docs
      </Link>

      {/* Render the section component */}
      {Section ? <Section /> : null}

      {/* Prev / next */}
      <div className="not-prose mt-12 pt-6 border-t border-slate-200 grid grid-cols-2 gap-3">
        {prev ? (
          <Link
            href={`/docs/${prev.slug}`}
            className="block rounded-lg border border-slate-200 hover:border-indigo-300 p-3 text-left"
          >
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Previous</div>
            <div className="text-sm font-medium text-slate-800 mt-0.5">
              {prev.title}
            </div>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/docs/${next.slug}`}
            className="block rounded-lg border border-slate-200 hover:border-indigo-300 p-3 text-right"
          >
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Next</div>
            <div className="text-sm font-medium text-slate-800 mt-0.5">
              {next.title}
            </div>
          </Link>
        ) : (
          <span />
        )}
      </div>
    </DocsLayout>
  );
}
