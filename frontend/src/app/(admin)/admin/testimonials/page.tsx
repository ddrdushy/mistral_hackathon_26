"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

interface Testimonial {
  id: number;
  quote: string;
  author_name: string;
  author_role: string;
  avatar_url: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  testimonials: Testimonial[];
}

const AVATAR_OPTIONS = [
  { value: "/landing/avatar-asian-woman.webp", label: "Avatar 1" },
  { value: "/landing/avatar-black-man.webp", label: "Avatar 2" },
  { value: "/landing/avatar-man-40s.webp", label: "Avatar 3" },
  { value: "/landing/avatar-woman-30s.webp", label: "Avatar 4" },
];

const EMPTY_DRAFT: Omit<Testimonial, "id" | "created_at" | "updated_at"> = {
  quote: "",
  author_name: "",
  author_role: "",
  avatar_url: AVATAR_OPTIONS[0].value,
  is_active: true,
  display_order: 0,
};

export default function AdminTestimonialsPage() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchData = useCallback(async () => {
    try {
      const data = await apiGet<ListResponse>("/admin/testimonials");
      setItems(data.testimonials);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load", "err");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const startNew = () => {
    setDraft({ ...EMPTY_DRAFT, display_order: items.length + 1 });
    setEditingId("new");
  };

  const startEdit = (t: Testimonial) => {
    setDraft({
      quote: t.quote,
      author_name: t.author_name,
      author_role: t.author_role,
      avatar_url: t.avatar_url,
      is_active: t.is_active,
      display_order: t.display_order,
    });
    setEditingId(t.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const save = async () => {
    if (!draft.quote.trim() || !draft.author_name.trim()) {
      showToast("Quote and name are required", "err");
      return;
    }
    setSaving(true);
    try {
      if (editingId === "new") {
        await apiPost("/admin/testimonials", draft);
        showToast("Testimonial added");
      } else if (typeof editingId === "number") {
        await apiPatch(`/admin/testimonials/${editingId}`, draft);
        showToast("Testimonial updated");
      }
      cancelEdit();
      fetchData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Save failed", "err");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t: Testimonial) => {
    try {
      await apiPatch(`/admin/testimonials/${t.id}`, { is_active: !t.is_active });
      fetchData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Update failed", "err");
    }
  };

  const remove = async (t: Testimonial) => {
    if (!confirm(`Delete the testimonial from "${t.author_name}"? This can't be undone.`)) return;
    try {
      await apiDelete(`/admin/testimonials/${t.id}`);
      showToast("Testimonial deleted");
      fetchData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed", "err");
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Testimonials</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage the testimonials shown on the public landing page. Active rows are
            displayed in <code className="font-mono text-xs">display_order</code> ascending.
          </p>
        </div>
        <button
          onClick={startNew}
          disabled={editingId !== null}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          New testimonial
        </button>
      </div>

      {/* Editor */}
      {editingId !== null && (
        <div className="mb-6 bg-white rounded-2xl border-2 border-blue-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">
            {editingId === "new" ? "New testimonial" : `Editing #${editingId}`}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Quote</label>
              <textarea
                value={draft.quote}
                onChange={(e) => setDraft({ ...draft, quote: e.target.value })}
                rows={3}
                placeholder="What did the customer say?"
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Author name</label>
                <input
                  type="text"
                  value={draft.author_name}
                  onChange={(e) => setDraft({ ...draft, author_name: e.target.value })}
                  placeholder="Priya Anand"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Author role</label>
                <input
                  type="text"
                  value={draft.author_role}
                  onChange={(e) => setDraft({ ...draft, author_role: e.target.value })}
                  placeholder="Head of Talent"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Avatar</label>
                <div className="flex gap-3">
                  {AVATAR_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDraft({ ...draft, avatar_url: opt.value })}
                      className={`relative w-12 h-12 rounded-full overflow-hidden ring-2 transition ${
                        draft.avatar_url === opt.value
                          ? "ring-blue-500 ring-offset-2"
                          : "ring-slate-200 hover:ring-slate-400"
                      }`}
                      title={opt.label}
                    >
                      <Image src={opt.value} alt={opt.label} fill sizes="48px" className="object-cover" />
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={draft.avatar_url}
                  onChange={(e) => setDraft({ ...draft, avatar_url: e.target.value })}
                  placeholder="/landing/avatar-… or full URL"
                  className="mt-2 w-full px-3 py-1.5 rounded-md border border-slate-300 text-xs font-mono text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Display order</label>
                <input
                  type="number"
                  value={draft.display_order}
                  onChange={(e) =>
                    setDraft({ ...draft, display_order: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
              />
              Active (shown on landing page)
            </label>
          </div>

          <div className="mt-6 flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <CheckIcon className="w-4 h-4" />
              {saving ? "Saving…" : editingId === "new" ? "Create" : "Save changes"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-slate-700 text-sm font-semibold border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              <XMarkIcon className="w-4 h-4" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="text-center text-slate-500 py-12">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center text-slate-500 py-12 bg-white rounded-2xl border border-slate-200">
          No testimonials yet. Click <span className="font-semibold">New testimonial</span> above to add one.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="text-left font-semibold px-4 py-3 w-12">#</th>
                <th className="text-left font-semibold px-4 py-3 w-14">Avatar</th>
                <th className="text-left font-semibold px-4 py-3">Author</th>
                <th className="text-left font-semibold px-4 py-3">Quote</th>
                <th className="text-center font-semibold px-4 py-3 w-20">Active</th>
                <th className="text-right font-semibold px-4 py-3 w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{t.display_order}</td>
                  <td className="px-4 py-3">
                    {t.avatar_url ? (
                      <div className="relative w-9 h-9 rounded-full overflow-hidden bg-slate-100">
                        <Image src={t.avatar_url} alt={t.author_name} fill sizes="36px" className="object-cover" />
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs">
                        {t.author_name.charAt(0)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{t.author_name}</div>
                    <div className="text-xs text-slate-500">{t.author_role}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700 max-w-md">
                    <p className="line-clamp-2">{t.quote}</p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => toggleActive(t)}
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold transition ${
                        t.is_active
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                    >
                      {t.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        onClick={() => startEdit(t)}
                        disabled={editingId !== null}
                        className="p-1.5 rounded-md text-slate-500 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 transition-colors"
                        title="Edit"
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => remove(t)}
                        disabled={editingId !== null}
                        className="p-1.5 rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 transition-colors"
                        title="Delete"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium z-50 ${
            toast.type === "ok" ? "bg-slate-900 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
