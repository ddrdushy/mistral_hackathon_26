"use client";

import Link from "next/link";
import DocsLayout from "@/components/docs/DocsLayout";
import { DOC_GROUPS, docsByGroup } from "@/lib/docs/registry";
import {
  BookOpenIcon,
  ArrowRightIcon,
} from "@heroicons/react/24/outline";

export default function DocsIndexPage() {
  const grouped = docsByGroup();
  return (
    <DocsLayout>
      <div className="flex items-center gap-2 mb-2">
        <BookOpenIcon className="w-6 h-6 text-indigo-600" />
        <h1 className="!mb-0">Documentation</h1>
      </div>
      <p className="lead">
        Walk-through of every page in the app — what it does, how to use
        it, where to find each action. Start with{" "}
        <Link href="/docs/getting-started">Signing up &amp; first steps</Link>{" "}
        if this is your first time.
      </p>

      <div className="not-prose space-y-8 mt-6">
        {DOC_GROUPS.map((group) => (
          <section key={group}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
              {group}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(grouped.get(group) || []).map((d) => (
                <Link
                  key={d.slug}
                  href={`/docs/${d.slug}`}
                  className="group block bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm p-4 transition-all"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
                        {d.title}
                      </div>
                      <p className="text-xs text-slate-500 mt-1 leading-snug">
                        {d.blurb}
                      </p>
                    </div>
                    <ArrowRightIcon className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 flex-shrink-0 mt-1" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DocsLayout>
  );
}
