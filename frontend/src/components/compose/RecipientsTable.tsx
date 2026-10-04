"use client";

import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { AlertCircle, Lock, Plus, X } from "lucide-react";
import { normalizeVariableName, type RecipientRow } from "@/lib/tuples";

type Row = Record<string, string>;

type Props = {
  variables: string[];
  onVariablesChange: (v: string[]) => void;
  rows: Row[];
  onRowsChange: (rows: Row[]) => void;
  recipients: RecipientRow[]; // validated rows (blank rows dropped), for error messages
};

const PLACEHOLDERS: Record<string, string> = {
  full_name: "Jane Doe",
  name: "Jane Doe",
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@stripe.com",
  role: "Engineering Manager",
  title: "Engineering Manager",
  team: "Payments",
  linkedin: "linkedin.com/in/…",
};

/** A cell that wraps its text and grows taller to show all of it, so paragraphs stay readable. */
function CellText({ value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} {...props} />;
}

export default function RecipientsTable({ variables, onVariablesChange, rows, onRowsChange, recipients }: Props) {
  const [draftVar, setDraftVar] = useState("");
  const tableRef = useRef<HTMLDivElement>(null);
  // A cell to focus once a newly added row has rendered.
  const pendingFocus = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    tableRef.current?.querySelector<HTMLTextAreaElement>(`[data-cell="${pendingFocus.current}"]`)?.focus();
    pendingFocus.current = null;
  }, [rows.length]);

  const errorsByRow = new Map(recipients.filter((r) => r.error).map((r) => [r.line - 1, r.error]));
  const filled = recipients.length;

  const focusCell = (r: number, c: number) =>
    tableRef.current?.querySelector<HTMLTextAreaElement>(`[data-cell="${r}-${c}"]`)?.focus();

  const setCell = (r: number, key: string, value: string) =>
    onRowsChange(rows.map((row, i) => (i === r ? { ...row, [key]: value } : row)));

  const addRow = (focusCol = 0) => {
    pendingFocus.current = `${rows.length}-${focusCol}`;
    onRowsChange([...rows, {}]);
  };

  const removeRow = (r: number) => onRowsChange(rows.length === 1 ? [{}] : rows.filter((_, i) => i !== r));

  const addVariable = () => {
    const name = normalizeVariableName(draftVar);
    if (name && !variables.includes(name)) onVariablesChange([...variables, name]);
    setDraftVar("");
  };

  // Enter moves down a row; Shift+Enter adds a line break inside the cell.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, r: number, c: number) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (r === rows.length - 1) addRow(c);
    else focusCell(r + 1, c);
  };

  // Pasting rows copied from a spreadsheet (tab-separated) fills the table starting at this cell.
  // Text with line breaks but no tabs is a paragraph, so it stays in this one cell.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>, r: number, c: number) => {
    const text = e.clipboardData.getData("text").replace(/\r/g, "").replace(/\n+$/, "");
    if (!text.includes("\t")) return;
    e.preventDefault();
    const next = rows.map((row) => ({ ...row }));
    text.split("\n").forEach((line, i) => {
      if (!next[r + i]) next.push({});
      line.split("\t").forEach((value, j) => {
        const key = variables[c + j];
        if (key) next[r + i][key] = value.trim();
      });
    });
    onRowsChange(next);
  };

  return (
    <div className="animate-fade-up rounded-2xl bg-cloud/70 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink">Recipients</h3>
        <span className="flex items-center gap-3 text-xs">
          <span className="text-steel">
            {filled} recipient{filled === 1 ? "" : "s"}
          </span>
          {errorsByRow.size > 0 && (
            <span className="flex items-center gap-1 font-medium text-crimson">
              <AlertCircle className="size-3.5" />
              {errorsByRow.size} row{errorsByRow.size === 1 ? " needs" : "s need"} fixing
            </span>
          )}
        </span>
      </div>

      <div ref={tableRef} className="overflow-x-auto rounded-xl border border-steel/20 bg-white shadow-sm">
        {/* Fixed column widths: extra variables widen the table and scroll, rather than squeezing columns. */}
        <table className="w-max min-w-full table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-cloud">
              <th className="w-10 px-2 py-2 text-center text-xs font-medium text-steel">#</th>
              {variables.map((v) => (
                <th key={v} className="w-52 border-l border-cloud px-3 py-2 font-medium">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-crimson">{v}</span>
                    {v === "email" ? (
                      <Lock className="size-3 text-steel" aria-label="required" />
                    ) : (
                      <button
                        onClick={() => onVariablesChange(variables.filter((x) => x !== v))}
                        className="rounded text-steel hover:text-crimson"
                        aria-label={`Remove variable ${v}`}
                        title="Remove variable"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </span>
                </th>
              ))}
              <th className="w-40 border-l border-cloud px-2 py-1.5">
                <form
                  className="flex items-center"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addVariable();
                  }}
                >
                  <input
                    value={draftVar}
                    onChange={(e) => setDraftVar(e.target.value)}
                    onBlur={addVariable}
                    placeholder="+ variable"
                    aria-label="Add variable"
                    className="w-full rounded-lg border border-dashed border-steel/40 bg-transparent px-2 py-1 text-xs font-medium outline-none placeholder:text-steel focus:border-scarlet"
                  />
                </form>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const error = errorsByRow.get(r);
              return (
                <Fragment key={r}>
                  <tr className={`group ${error ? "bg-crimson/5" : "border-b border-cloud last:border-0"}`}>
                    <td className="px-2 pt-3 text-center align-top text-xs text-steel">{r + 1}</td>
                    {variables.map((v, c) => (
                      <td
                        key={v}
                        className="cursor-text border-l border-cloud p-0 align-top focus-within:bg-scarlet/5 focus-within:shadow-[inset_0_0_0_2px_var(--color-scarlet)]"
                        onClick={(e) => e.currentTarget.querySelector("textarea")?.focus()}
                      >
                        <CellText
                          data-cell={`${r}-${c}`}
                          value={row[v] ?? ""}
                          onChange={(e) => setCell(r, v, e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                          onPaste={(e) => onPaste(e, r, c)}
                          placeholder={r === 0 && !Object.values(row).some((x) => x?.trim()) ? (PLACEHOLDERS[v] ?? v.replace(/_/g, " ")) : ""}
                          spellCheck={v !== "email"}
                          aria-label={`Row ${r + 1} ${v}`}
                          className="block w-full resize-none overflow-hidden bg-transparent px-3 py-2.5 leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap text-ink outline-none placeholder:text-steel/50"
                        />
                      </td>
                    ))}
                    <td className="border-l border-cloud px-2 pt-2 text-right align-top">
                      <button
                        onClick={() => removeRow(r)}
                        className="rounded-lg p-1 text-steel opacity-0 group-hover:opacity-100 hover:bg-cloud hover:text-crimson focus:opacity-100"
                        aria-label={`Remove row ${r + 1}`}
                      >
                        <X className="size-4" />
                      </button>
                    </td>
                  </tr>
                  {error && (
                    <tr className="border-b border-cloud bg-crimson/5 last:border-0">
                      <td />
                      <td colSpan={variables.length + 1} className="px-3 pb-2 text-xs text-crimson">
                        {error}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={() => addRow()}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-ink hover:bg-white"
        >
          <Plus className="size-4" /> Add recipient
        </button>
        <span className="hidden text-xs text-steel sm:inline">Enter moves to the next row · Shift+Enter for a new line · paste from a spreadsheet to fill many</span>
      </div>
    </div>
  );
}
