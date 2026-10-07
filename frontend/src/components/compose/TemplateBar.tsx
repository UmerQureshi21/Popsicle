"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, FilePlus2, FileText, Loader2, Save, Trash2 } from "lucide-react";
import { api, type Template } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Button, Modal, Popover } from "@/components/ui";

type Props = {
  subject: string;
  body: string;
  variables: string[];
  templateId: number | null;
  onLoad: (t: Template) => void;
  onNew: () => void;
  onSaved: (t: Template) => void;
  onDeleted: (id: number) => void;
};

type NameDialog = { mode: "new" | "copy"; then?: () => void };

/**
 * Which saved template is being edited, whether it has unsaved changes, and controls to save,
 * save as a copy, switch to another template or start a blank draft. Switching away from unsaved
 * work always asks first.
 */
export default function TemplateBar({ subject, body, variables, templateId, onLoad, onNew, onSaved, onDeleted }: Props) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.get<Template[]>("/api/templates").then(setTemplates, (e) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);

  const loaded = templates?.find((t) => t.id === templateId) ?? null;
  const isBlank = !subject.trim() && !body.trim();
  const dirty = loaded ? loaded.subject !== subject || loaded.body !== body : !isBlank;

  /** Run `action` now, or ask first if it would throw away unsaved edits. */
  const guard = (action: () => void) => {
    setMenuOpen(false);
    if (dirty && templates) setPending(() => action);
    else action();
  };

  const save = async (): Promise<boolean> => {
    if (!loaded) return false;
    setSaving(true);
    setError(null);
    try {
      const t = await api.put<Template>(`/api/templates/${loaded.id}`, { name: loaded.name, subject, body, variables });
      onSaved(t);
      refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAs = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const t = await api.post<Template>("/api/templates", { name: name.trim(), subject, body, variables });
      onSaved(t);
      refresh();
      const then = nameDialog?.then;
      setNameDialog(null);
      then?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openNameDialog = (mode: NameDialog["mode"], then?: () => void) => {
    setError(null);
    setName(mode === "copy" && loaded ? `${loaded.name} (copy)` : "");
    setNameDialog({ mode, then });
  };

  const remove = async (t: Template) => {
    await api.del(`/api/templates/${t.id}`);
    setConfirmDelete(null);
    onDeleted(t.id); // if it was the one being edited, its text stays as an unsaved draft
    refresh();
  };

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-steel/15 pb-4">
      <div className="relative flex min-w-0 items-center gap-2">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex min-w-0 items-center gap-2 rounded-xl border border-steel/25 bg-paper px-3 py-2 text-sm font-medium text-ink shadow-sm transition-colors hover:border-steel/50"
        >
          <FileText className="size-4 shrink-0 text-steel" />
          <span className="truncate">{loaded?.name ?? "Untitled draft"}</span>
          <ChevronDown className={`size-4 shrink-0 text-steel transition-transform ${menuOpen ? "rotate-180" : ""}`} />
        </button>
        {dirty && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-steel">
            <span className="size-1.5 rounded-full bg-scarlet" />
            {loaded ? "Edited" : "Not saved"}
          </span>
        )}

        <Popover open={menuOpen} onClose={() => setMenuOpen(false)} className="top-full left-0 mt-2 w-80 max-w-[calc(100vw-3rem)] p-2">
          <button
            onClick={() => guard(onNew)}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink hover:bg-cloud"
          >
            <FilePlus2 className="size-4 text-crimson" />
            New blank draft
          </button>
          <div className="my-1.5 border-t border-cloud" />
          <p className="px-3 pt-1 pb-1.5 text-xs font-semibold tracking-wide text-steel uppercase">Saved templates</p>
          {!templates ? (
            <p className="px-3 py-3 text-sm text-steel">Loading…</p>
          ) : templates.length === 0 ? (
            <p className="px-3 py-3 text-sm text-steel">Nothing saved yet. Use “Save draft” to keep this one.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {templates.map((t) => (
                <li key={t.id} className="group flex items-center gap-1 rounded-xl hover:bg-cloud">
                  <button
                    onClick={() => (t.id === templateId ? setMenuOpen(false) : guard(() => onLoad(t)))}
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <span className="truncate">{t.name}</span>
                      {t.id === templateId && <Check className="size-3.5 shrink-0 text-crimson" />}
                    </span>
                    <span className="block truncate text-xs text-steel">
                      {t.subject || "(no subject)"} · {timeAgo(t.updated_at)}
                    </span>
                  </button>
                  {confirmDelete === t.id ? (
                    <button
                      onClick={() => remove(t)}
                      className="mr-1.5 shrink-0 rounded-lg bg-crimson px-2 py-1 text-xs font-medium text-white hover:bg-scarlet"
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(t.id)}
                      className="mr-1 shrink-0 rounded-lg p-1.5 text-steel opacity-0 group-hover:opacity-100 hover:bg-paper hover:text-crimson focus:opacity-100"
                      aria-label={`Delete ${t.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Popover>
      </div>

      <div className="flex items-center gap-1.5">
        {loaded ? (
          <>
            <Button variant="ghost" className="px-3 py-1.5" onClick={() => openNameDialog("copy")}>
              Save as new
            </Button>
            <Button className="px-3 py-1.5" disabled={!dirty || saving} onClick={save}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {dirty ? "Save" : "Saved"}
            </Button>
          </>
        ) : (
          <Button className="px-3 py-1.5" disabled={isBlank} onClick={() => openNameDialog("new")}>
            <Save className="size-4" />
            Save draft
          </Button>
        )}
      </div>
      {error && !nameDialog && <p className="w-full text-xs text-crimson">{error}</p>}

      {/* Name a new template */}
      <Modal
        open={!!nameDialog}
        onClose={() => setNameDialog(null)}
        title={nameDialog?.mode === "copy" ? "Save as a new template" : "Save draft"}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setNameDialog(null)}>Cancel</Button>
            <Button variant="primary" disabled={!name.trim() || saving} onClick={saveAs}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </div>
        }
      >
        <form
          className="p-6"
          onSubmit={(e) => {
            e.preventDefault();
            saveAs();
          }}
        >
          <label className="block">
            <span className="text-sm font-medium text-ink">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Learning more about the industry"
              className="mt-1.5 w-full rounded-xl border border-steel/30 px-3 py-2.5 text-sm outline-none focus:border-scarlet focus:ring-4 focus:ring-scarlet/10"
            />
          </label>
          <p className="mt-2 text-xs text-steel">Saves the subject and body{nameDialog?.mode === "copy" && loaded ? `; “${loaded.name}” stays as it was` : ""}.</p>
          {error && <p className="mt-3 text-sm text-crimson">{error}</p>}
        </form>
      </Modal>

      {/* Unsaved changes */}
      <Modal
        open={!!pending}
        compact
        onClose={() => setPending(null)}
        title="Unsaved changes"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setPending(null)}>Keep editing</Button>
            <Button
              variant="danger"
              onClick={() => {
                const action = pending;
                setPending(null);
                action?.();
              }}
            >
              Discard changes
            </Button>
            <Button
              variant="primary"
              disabled={saving}
              onClick={async () => {
                const action = pending;
                setPending(null);
                if (loaded) {
                  if (await save()) action?.();
                } else {
                  openNameDialog("new", action ?? undefined);
                }
              }}
            >
              {loaded ? `Save “${loaded.name}” first` : "Save draft first"}
            </Button>
          </div>
        }
      >
        <p className="p-6 text-sm leading-relaxed text-ink/80">
          {loaded
            ? `Your changes to “${loaded.name}” haven’t been saved. Save them before switching, or discard them?`
            : "This draft hasn’t been saved. Save it before switching, or discard it?"}
        </p>
      </Modal>
    </div>
  );
}
