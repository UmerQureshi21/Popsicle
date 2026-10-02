"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { api, type Template } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Button, Popover } from "@/components/ui";

type Props = {
  open: boolean;
  onClose: () => void;
  current: { subject: string; body: string; variables: string[] };
  loadedId: number | null;
  onLoad: (t: Template) => void;
  onSaved: (t: Template) => void;
};

export default function TemplateMenu({ open, onClose, current, loadedId, onLoad, onSaved }: Props) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.get<Template[]>("/api/templates").then(setTemplates, (e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const loaded = templates.find((t) => t.id === loadedId);

  const save = async (id?: number) => {
    setError(null);
    const body = { ...current, name: id ? loaded!.name : name.trim() };
    try {
      const t = id ? await api.put<Template>(`/api/templates/${id}`, body) : await api.post<Template>("/api/templates", body);
      setName("");
      onSaved(t);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: number) => {
    await api.del(`/api/templates/${id}`);
    refresh();
  };

  return (
    <Popover open={open} onClose={onClose} className="bottom-full left-0 mb-3 w-80">
      <p className="mb-2 text-xs font-semibold tracking-wide text-steel uppercase">Templates</p>
      {templates.length === 0 ? (
        <p className="py-3 text-sm text-steel">No saved templates yet.</p>
      ) : (
        <ul className="-mx-2 max-h-56 overflow-y-auto">
          {templates.map((t) => (
            <li key={t.id} className="group flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-cloud">
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  onLoad(t);
                  onClose();
                }}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  {t.id === loadedId && <Check className="size-3.5 text-crimson" />}
                  <span className="truncate">{t.name}</span>
                </span>
                <span className="block truncate text-xs text-steel">
                  {t.subject || "(no subject)"} · {timeAgo(t.updated_at)}
                </span>
              </button>
              <button
                onClick={() => remove(t.id)}
                className="rounded-lg p-1.5 text-steel opacity-0 group-hover:opacity-100 hover:bg-white hover:text-crimson"
                aria-label={`Delete ${t.name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 space-y-2 border-t border-cloud pt-3">
        {loaded && (
          <Button variant="secondary" className="w-full" onClick={() => save(loaded.id)}>
            Update “{loaded.name}”
          </Button>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Save current as…"
            className="min-w-0 flex-1 rounded-xl border border-steel/30 px-3 py-2 text-sm outline-none focus:border-scarlet"
          />
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Save
          </Button>
        </form>
        {error && <p className="text-xs text-crimson">{error}</p>}
      </div>
    </Popover>
  );
}
