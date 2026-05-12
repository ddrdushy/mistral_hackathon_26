"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DocumentTextIcon,
  PaperAirplaneIcon,
  ArrowPathIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import Card from "@/components/ui/Card";
import { apiGet, apiPost } from "@/lib/api";
import GenerateOfferModal from "./GenerateOfferModal";

interface OfferRow {
  id: number;
  application_id: number;
  candidate_id: number;
  template_id: number | null;
  salary_amount: number | null;
  salary_currency: string;
  bonus_amount: number | null;
  equity_description: string;
  employment_type: string;
  start_date: string | null;
  location: string;
  custom_fields: Record<string, unknown>;
  status: string;
  esign_provider: string;
  esign_envelope_id: string;
  signing_url: string;
  signature_name: string;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  expires_at: string | null;
  declined_reason: string;
  created_at: string | null;
  updated_at: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  pending_approval: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
  sent: "bg-indigo-100 text-indigo-700",
  viewed: "bg-violet-100 text-violet-700",
  signed: "bg-emerald-100 text-emerald-700",
  declined: "bg-rose-100 text-rose-700",
  expired: "bg-slate-100 text-slate-500",
  withdrawn: "bg-slate-100 text-slate-500",
};

export default function OfferCard({
  applicationId,
  candidateName,
  jobTitle,
  candidateEmail,
  gateReason,
}: {
  applicationId: number;
  candidateName: string;
  jobTitle: string;
  candidateEmail: string;
  /** When set, the Generate-offer button is disabled and this string is
   *  rendered as the empty-state copy + tooltip. Null = allow generation. */
  gateReason?: string | null;
}) {
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiGet<{ offers: OfferRow[] }>(
        `/offers?application_id=${applicationId}`,
      );
      setOffers(res.offers ?? []);
    } catch {
      setOffers([]);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async (id: number) => {
    if (!confirm("Send this offer to the candidate for signature?")) return;
    try {
      setBusyId(id);
      await apiPost(`/offers/${id}/send`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusyId(null);
    }
  };

  const withdraw = async (id: number) => {
    if (!confirm("Withdraw this offer? The signing link will be invalidated.")) return;
    try {
      setBusyId(id);
      await apiPost(`/offers/${id}/withdraw`);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Withdraw failed");
    } finally {
      setBusyId(null);
    }
  };

  const fmtSalary = (amount: number | null, currency: string) => {
    if (amount == null) return "—";
    const sym: Record<string, string> = {
      USD: "$", EUR: "€", GBP: "£", INR: "₹", SGD: "S$",
    };
    return `${sym[currency] || currency + " "}${amount.toLocaleString()}`;
  };

  const copySigningUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      alert("Signing link copied to clipboard");
    } catch {
      prompt("Copy this signing URL:", url);
    }
  };

  const gated = Boolean(gateReason);

  return (
    <Card
      title="Offer"
      action={
        <button
          type="button"
          onClick={() => setGenerateOpen(true)}
          disabled={gated}
          title={gateReason ?? undefined}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${
            gated
              ? "text-slate-400 bg-slate-100 cursor-not-allowed"
              : "text-white bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          <DocumentTextIcon className="h-4 w-4" />
          Generate offer
        </button>
      }
    >
      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : offers.length === 0 ? (
        gated ? (
          <p className="text-sm text-slate-500">{gateReason}</p>
        ) : (
          <p className="text-sm text-slate-500">
            No offer yet. Click <strong>Generate offer</strong> to draft one.
          </p>
        )
      ) : (
        <ul className="space-y-3">
          {offers.map((o) => (
            <li
              key={o.id}
              className="border border-slate-200 rounded-md p-3 flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold ${
                      STATUS_BADGE[o.status] || STATUS_BADGE.draft
                    }`}
                  >
                    {o.status.replace("_", " ")}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    {fmtSalary(o.salary_amount, o.salary_currency)}
                  </span>
                  {o.bonus_amount != null && o.bonus_amount > 0 && (
                    <span className="text-xs text-slate-500">
                      + bonus {fmtSalary(o.bonus_amount, o.salary_currency)}
                    </span>
                  )}
                  {o.start_date && (
                    <span className="text-xs text-slate-500">
                      · starts {new Date(o.start_date).toLocaleDateString()}
                    </span>
                  )}
                  {o.location && (
                    <span className="text-xs text-slate-500">· {o.location}</span>
                  )}
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-3 flex-wrap">
                  {o.sent_at && <span>Sent {new Date(o.sent_at).toLocaleString()}</span>}
                  {o.viewed_at && <span>Viewed {new Date(o.viewed_at).toLocaleString()}</span>}
                  {o.signed_at && (
                    <span className="text-emerald-700">
                      Signed by <strong>{o.signature_name}</strong>{" "}
                      {new Date(o.signed_at).toLocaleString()}
                    </span>
                  )}
                  {o.declined_reason && (
                    <span className="text-rose-700 truncate">
                      Declined: {o.declined_reason}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <a
                    href={`/api/v1/offers/${o.id}/document`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
                  >
                    View document →
                  </a>
                  {o.signing_url && (o.status === "sent" || o.status === "viewed") && (
                    <button
                      type="button"
                      onClick={() => copySigningUrl(o.signing_url)}
                      className="text-xs font-medium text-slate-700 hover:text-slate-900"
                    >
                      Copy signing link
                    </button>
                  )}
                  {o.status === "draft" && (
                    <button
                      type="button"
                      onClick={() => send(o.id)}
                      disabled={busyId === o.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded disabled:opacity-50"
                    >
                      <PaperAirplaneIcon className="h-3.5 w-3.5" />
                      Send for signature
                    </button>
                  )}
                  {(o.status === "sent" || o.status === "viewed" || o.status === "draft") && (
                    <button
                      type="button"
                      onClick={() => withdraw(o.id)}
                      disabled={busyId === o.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded disabled:opacity-50"
                    >
                      <XCircleIcon className="h-3.5 w-3.5" />
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <GenerateOfferModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onCreated={() => {
          setGenerateOpen(false);
          load();
        }}
        applicationId={applicationId}
        candidateName={candidateName}
        jobTitle={jobTitle}
        candidateEmail={candidateEmail}
      />
    </Card>
  );
}
