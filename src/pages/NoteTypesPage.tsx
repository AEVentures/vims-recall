import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { CardRenderer } from "@/components/CardRenderer";
import { collection } from "@/data/collection";
import { DEFAULT_CSS } from "@/domain/defaults";
import { renderCard } from "@/domain/template";
import type { NoteId, NoteType, NoteTypeId } from "@/domain/types";
import { useNoteTypes } from "@/hooks/useCollection";
import { errorMessage, pluralize } from "@/lib/utils";

export const NoteTypesPage = (): JSX.Element => {
  const noteTypes = useNoteTypes();
  const [selectedId, setSelectedId] = useState<NoteTypeId | "">("");
  const [draft, setDraft] = useState<NoteType | null>(null);
  const [templateIdx, setTemplateIdx] = useState(0);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const usage = useLiveQuery(async () => {
    const notes = await collection.allNotes();
    const m = new Map<NoteTypeId, number>();
    notes.forEach((n) => m.set(n.noteTypeId, (m.get(n.noteTypeId) ?? 0) + 1));
    return m;
  }, []);

  useEffect(() => {
    if (!noteTypes || noteTypes.length === 0) return;
    const current = noteTypes.find((n) => n.id === selectedId) ?? noteTypes[0];
    if (!current) return;
    if (current.id !== selectedId) setSelectedId(current.id);
    if (!draft || draft.id !== current.id) {
      setDraft(structuredClone(current));
      setTemplateIdx(0);
    }
  }, [noteTypes, selectedId, draft]);

  const preview = useMemo(() => {
    if (!draft) return null;
    const fields = draft.fields.map((f) => (draft.isCloze && f.ord === 0 ? `Sample {{c1::${f.name}}} text` : `(${f.name})`));
    const note = { id: "p" as NoteId, noteTypeId: draft.id, fields, tags: ["tag"], sortField: "", createdAt: 0, modifiedAt: 0 };
    return renderCard({ note, noteType: draft, ord: draft.isCloze ? 0 : templateIdx, deckName: "Deck", cardName: draft.templates[templateIdx]?.name ?? "" });
  }, [draft, templateIdx]);

  const template = draft?.templates[templateIdx];

  const save = async (): Promise<void> => {
    if (!draft) return;
    try {
      await collection.saveNoteType(draft);
      setStatus({ kind: "ok", text: "Saved. Cards were regenerated where templates changed." });
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  };

  const create = async (): Promise<void> => {
    const name = window.prompt("Name for the new note type");
    if (!name) return;
    const nt = await collection.createNoteType({
      name,
      fields: [
        { name: "Front", ord: 0, sticky: false, rtl: false },
        { name: "Back", ord: 1, sticky: false, rtl: false }
      ],
      templates: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}" }],
      css: DEFAULT_CSS,
      isCloze: false,
      sortFieldOrd: 0
    });
    setSelectedId(nt.id);
    setDraft(structuredClone(nt));
  };

  const remove = async (): Promise<void> => {
    if (!draft) return;
    if (!window.confirm(`Delete note type "${draft.name}"?`)) return;
    try {
      await collection.deleteNoteType(draft.id);
      setSelectedId("");
      setDraft(null);
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  };

  const setField = (i: number, patch: Partial<NoteType["fields"][number]>): void => setDraft((d) => (d ? { ...d, fields: d.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) } : d));
  const moveField = (i: number, dir: -1 | 1): void =>
    setDraft((d) => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.fields.length) return d;
      const fields = [...d.fields];
      const a = fields[i];
      const b = fields[j];
      if (!a || !b) return d;
      fields[i] = b;
      fields[j] = a;
      return { ...d, fields: fields.map((f, idx) => ({ ...f, ord: idx })) };
    });
  const addField = (): void => setDraft((d) => (d ? { ...d, fields: [...d.fields, { name: `Field ${d.fields.length + 1}`, ord: d.fields.length, sticky: false, rtl: false }] } : d));
  const removeField = (i: number): void => setDraft((d) => (d && d.fields.length > 1 ? { ...d, fields: d.fields.filter((_f, idx) => idx !== i).map((f, idx) => ({ ...f, ord: idx })), sortFieldOrd: Math.min(d.sortFieldOrd, d.fields.length - 2) } : d));

  const setTemplate = (patch: Partial<NoteType["templates"][number]>): void => setDraft((d) => (d ? { ...d, templates: d.templates.map((t, idx) => (idx === templateIdx ? { ...t, ...patch } : t)) } : d));
  const addTemplate = (): void =>
    setDraft((d) => {
      if (!d || d.isCloze) return d;
      const ord = d.templates.length;
      setTemplateIdx(ord);
      return { ...d, templates: [...d.templates, { name: `Card ${ord + 1}`, ord, qfmt: "", afmt: "{{FrontSide}}<hr id=answer>" }] };
    });
  const removeTemplate = (): void =>
    setDraft((d) => {
      if (!d || d.templates.length <= 1) return d;
      setTemplateIdx(0);
      return { ...d, templates: d.templates.filter((_t, idx) => idx !== templateIdx).map((t, idx) => ({ ...t, ord: idx })) };
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Note types</h1>
        <div className="flex gap-2">
          <Select className="w-64" value={selectedId} onChange={(e) => setSelectedId(e.target.value as NoteTypeId)} aria-label="Note type">
            {(noteTypes ?? []).map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} · {pluralize(usage?.get(n.id) ?? 0, "note")}
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={() => void create()}>
            <Plus /> New
          </Button>
        </div>
      </div>

      {status ? <p role="status" className={status.kind === "ok" ? "text-sm text-good" : "text-sm text-destructive"}>{status.text}</p> : null}

      {draft ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,24rem)]">
          <div className="space-y-6">
            <section className="glass rounded-xl p-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nt-name">Name</Label>
                  <Input id="nt-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="nt-sort">Sort field</Label>
                  <Select id="nt-sort" value={draft.sortFieldOrd} onChange={(e) => setDraft({ ...draft, sortFieldOrd: Number(e.target.value) })}>
                    {draft.fields.map((f, i) => <option key={i} value={i}>{f.name}</option>)}
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Fields</h2>
                <Button size="sm" variant="secondary" onClick={addField}><Plus /> Add field</Button>
              </div>
              <ul className="space-y-2">
                {draft.fields.map((f, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Input value={f.name} onChange={(e) => setField(i, { name: e.target.value })} aria-label={`Field ${i + 1} name`} />
                    <label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={f.sticky} onChange={(e) => setField(i, { sticky: e.target.checked })} /> sticky</label>
                    <Button size="icon" variant="ghost" aria-label="Move up" onClick={() => moveField(i, -1)} disabled={i === 0}><ArrowUp /></Button>
                    <Button size="icon" variant="ghost" aria-label="Move down" onClick={() => moveField(i, 1)} disabled={i === draft.fields.length - 1}><ArrowDown /></Button>
                    <Button size="icon" variant="ghost" aria-label="Remove field" onClick={() => removeField(i)} disabled={draft.fields.length <= 1}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="glass rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Card templates</h2>
                {!draft.isCloze ? (
                  <div className="flex items-center gap-2">
                    <Select className="h-9 w-40" value={templateIdx} onChange={(e) => setTemplateIdx(Number(e.target.value))} aria-label="Template">
                      {draft.templates.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
                    </Select>
                    <Button size="sm" variant="secondary" onClick={addTemplate}><Plus /> Add</Button>
                    <Button size="sm" variant="ghost" onClick={removeTemplate} disabled={draft.templates.length <= 1}><Trash2 /></Button>
                  </div>
                ) : null}
              </div>
              {template ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="tpl-name">Template name</Label>
                    <Input id="tpl-name" value={template.name} onChange={(e) => setTemplate({ name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tpl-q" hint="{{Field}}, {{cloze:Field}}, {{hint:Field}}, {{#Field}}…{{/Field}}">Front template</Label>
                    <Textarea id="tpl-q" className="font-mono text-xs" rows={4} value={template.qfmt} onChange={(e) => setTemplate({ qfmt: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tpl-a" hint="{{FrontSide}} inserts the front">Back template</Label>
                    <Textarea id="tpl-a" className="font-mono text-xs" rows={4} value={template.afmt} onChange={(e) => setTemplate({ afmt: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tpl-css">Styling (CSS, shared by all cards of this type)</Label>
                    <Textarea id="tpl-css" className="font-mono text-xs" rows={5} value={draft.css} onChange={(e) => setDraft({ ...draft, css: e.target.value })} />
                  </div>
                </div>
              ) : null}
            </section>

            <div className="flex gap-2">
              <Button onClick={() => void save()}>Save</Button>
              <Button variant="ghost" onClick={() => setDraft(structuredClone(noteTypes?.find((n) => n.id === draft.id) ?? draft))}>Revert</Button>
              <Button variant="destructive" className="ml-auto" onClick={() => void remove()} disabled={(usage?.get(draft.id) ?? 0) > 0}>Delete</Button>
            </div>
          </div>

          <aside className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Preview</h2>
            {preview ? (
              <div className="glass rounded-xl p-4 space-y-3">
                <CardRenderer html={preview.question} css={preview.css} className="text-base" />
                <hr className="border-border" />
                <CardRenderer html={preview.answer} css={preview.css} className="text-base text-muted-foreground" />
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
};
