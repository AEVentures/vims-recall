import { useRef, type KeyboardEvent } from "react";
import { Bold, Braces, Italic, Underline } from "lucide-react";
import { Button, Label, Textarea } from "@/components/ui";
import { clozeNumbers } from "@/domain/template";
import type { NoteType } from "@/domain/types";

interface NoteEditorProps {
  noteType: NoteType;
  fields: string[];
  onChange: (fields: string[]) => void;
  /** optional: focus first field on mount */
  autoFocus?: boolean;
}

const wrapSelection = (el: HTMLTextAreaElement, before: string, after: string): string => {
  const { selectionStart, selectionEnd, value } = el;
  const selected = value.slice(selectionStart, selectionEnd);
  const next = value.slice(0, selectionStart) + before + selected + after + value.slice(selectionEnd);
  requestAnimationFrame(() => {
    el.focus();
    const pos = selectionStart + before.length;
    el.setSelectionRange(pos, pos + selected.length);
  });
  return next;
};

export const NoteEditor = ({ noteType, fields, onChange, autoFocus }: NoteEditorProps): JSX.Element => {
  const refs = useRef<Array<HTMLTextAreaElement | null>>([]);

  const update = (i: number, value: string): void => {
    const next = [...fields];
    next[i] = value;
    onChange(next);
  };

  const applyWrap = (i: number, before: string, after: string): void => {
    const el = refs.current[i];
    if (!el) return;
    update(i, wrapSelection(el, before, after));
  };

  const addCloze = (i: number, sameNumber: boolean): void => {
    const el = refs.current[i];
    if (!el) return;
    const existing = clozeNumbers(el.value);
    const max = existing.length > 0 ? Math.max(...existing) : 0;
    const n = sameNumber ? Math.max(1, max) : max + 1;
    applyWrap(i, `{{c${n}::`, "}}");
  };

  const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === "b") {
      e.preventDefault();
      applyWrap(i, "<b>", "</b>");
    } else if (key === "i") {
      e.preventDefault();
      applyWrap(i, "<i>", "</i>");
    } else if (key === "u") {
      e.preventDefault();
      applyWrap(i, "<u>", "</u>");
    } else if (e.shiftKey && key === "c") {
      e.preventDefault();
      addCloze(i, e.altKey);
    }
  };

  return (
    <div className="space-y-4">
      {noteType.fields.map((f, i) => (
        <div key={f.name} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={`field-${i}`}>{f.name}</Label>
            <div className="flex items-center gap-0.5">
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Bold (Ctrl+B)" title="Bold (Ctrl+B)" onClick={() => applyWrap(i, "<b>", "</b>")}>
                <Bold />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Italic (Ctrl+I)" title="Italic (Ctrl+I)" onClick={() => applyWrap(i, "<i>", "</i>")}>
                <Italic />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Underline (Ctrl+U)" title="Underline (Ctrl+U)" onClick={() => applyWrap(i, "<u>", "</u>")}>
                <Underline />
              </Button>
              {noteType.isCloze ? (
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Cloze deletion (Ctrl+Shift+C)" title="Cloze deletion (Ctrl+Shift+C). Alt for same number." onClick={() => addCloze(i, false)}>
                  <Braces />
                </Button>
              ) : null}
            </div>
          </div>
          <Textarea
            id={`field-${i}`}
            ref={(el) => {
              refs.current[i] = el;
            }}
            autoFocus={autoFocus && i === 0}
            dir={f.rtl ? "rtl" : undefined}
            value={fields[i] ?? ""}
            onChange={(e) => update(i, e.target.value)}
            onKeyDown={onKeyDown(i)}
            rows={i === 0 ? 3 : 2}
            className="text-base"
            placeholder={noteType.isCloze && i === 0 ? "The capital of France is {{c1::Paris}}." : undefined}
          />
        </div>
      ))}
    </div>
  );
};
