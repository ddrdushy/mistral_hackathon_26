import MarketingShell from "./MarketingShell";

interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export default function LegalLayout({
  title,
  lastUpdated,
  children,
}: LegalLayoutProps) {
  return (
    <MarketingShell>
      <div className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-xs uppercase tracking-wider text-indigo-600 font-semibold mb-2">
          Legal
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {lastUpdated}</p>

        <div className="mt-8 prose prose-slate max-w-none [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900 [&_h3]:mt-5 [&_h3]:mb-2 [&_p]:text-slate-700 [&_p]:leading-relaxed [&_p]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ul]:space-y-1 [&_li]:text-slate-700 [&_a]:text-indigo-600 [&_a]:underline">
          {children}
        </div>
      </div>
    </MarketingShell>
  );
}
