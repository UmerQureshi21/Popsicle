"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { api, type Profile } from "@/lib/api";
import { ABOUT_HINT, FORMAT_TIP } from "@/lib/coffeeChat";
import { Button, Modal } from "@/components/ui";

/** The "About me" button at the top of the Inbox: the first half of every coffee chat sheet. */
export default function AboutMe() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserRound className="size-4" /> About me
      </Button>
      {open && <AboutMeForm onClose={() => setOpen(false)} />}
    </>
  );
}

function AboutMeForm({ onClose }: { onClose: () => void }) {
  const [about, setAbout] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Profile>("/api/profile").then(
      (p) => setAbout(p.about),
      (e) => setError((e as Error).message),
    );
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put<Profile>("/api/profile", { about: about ?? "" });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <UserRound className="size-5 text-crimson" /> About me
        </span>
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={about === null || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 p-6">
        <p className="text-sm text-steel">
          The top of every coffee chat sheet: who you are and what you’re working on. Your notes on each person go underneath.
        </p>
        <textarea
          value={about ?? ""}
          onChange={(e) => setAbout(e.target.value)}
          disabled={about === null}
          placeholder={about === null ? "Loading…" : ABOUT_HINT}
          aria-label="About me"
          rows={12}
          maxLength={20000}
          className="block w-full resize-y rounded-2xl border border-steel/30 bg-paper p-4 text-sm leading-relaxed text-ink outline-none placeholder:text-steel/70 focus:border-scarlet focus:ring-4 focus:ring-scarlet/10"
        />
        <p className="text-xs text-steel">{FORMAT_TIP}</p>
        {error && <p className="text-sm text-crimson">{error}</p>}
      </div>
    </Modal>
  );
}
