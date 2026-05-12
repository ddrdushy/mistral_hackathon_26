"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOC_GROUPS, docsByGroup } from "@/lib/docs/registry";
import { BookOpenIcon } from "@heroicons/react/24/outline";

/**
 * Two-column docs layout: sidebar nav on the left, MDX-style content
 * on the right. The sidebar collapses on mobile (just shows the
 * current section) so we don't burn screen real-estate.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const grouped = docsByGroup();

  return (
    <div className="flex gap-8 max-w-7xl">
      <aside className="hidden lg:block w-64 flex-shrink-0">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-3">
          <div className="flex items-center gap-2 mb-4">
            <BookOpenIcon className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">Docs</h2>
          </div>

          {DOC_GROUPS.map((group) => (
            <div key={group} className="mb-5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                {group}
              </div>
              <ul className="space-y-0.5">
                {(grouped.get(group) || []).map((d) => {
                  const href = `/docs/${d.slug}`;
                  const active = pathname === href;
                  return (
                    <li key={d.slug}>
                      <Link
                        href={href}
                        className={`block px-2 py-1.5 rounded-md text-sm transition-colors ${
                          active
                            ? "bg-indigo-50 text-indigo-700 font-semibold"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {d.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 min-w-0 prose prose-slate max-w-3xl">
        {children}
      </main>
    </div>
  );
}


/**
 * Drop-in screenshot component. Falls back to a placeholder when the
 * referenced image is missing on disk (so docs ship usable even before
 * the Playwright capture run completes).
 */
export function DocImage({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  return (
    <figure className="my-6">
      <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="w-full h-auto block"
          onError={(e) => {
            const el = e.currentTarget;
            el.style.display = "none";
            const sib = el.nextElementSibling as HTMLElement | null;
            if (sib) sib.style.display = "flex";
          }}
        />
        <div
          className="hidden items-center justify-center text-xs text-slate-400 italic h-40"
          aria-hidden="true"
        >
          Screenshot pending: {src.split("/").pop()}
        </div>
      </div>
      {caption && (
        <figcaption className="text-xs text-slate-500 mt-2 text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}


/** Inline kbd-style chip for keystrokes / UI element references. */
export function K({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-slate-100 border border-slate-300 rounded">
      {children}
    </kbd>
  );
}


/** Inline call-out box. */
export function Tip({
  kind = "info",
  children,
}: {
  kind?: "info" | "warning" | "success";
  children: React.ReactNode;
}) {
  const cls = {
    info: "border-indigo-200 bg-indigo-50 text-indigo-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[kind];
  return (
    <div className={`not-prose rounded-lg border px-4 py-3 my-4 text-sm ${cls}`}>
      {children}
    </div>
  );
}
