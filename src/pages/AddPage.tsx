import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye } from "lucide-react";
import { Button, Label, Select } from "@/components/ui";
import { CardRenderer } from "@/components/CardRenderer";
import { NoteEditor } from "@/components/NoteEditor";
import { TagInput } from "@/components/TagInput";
import { collection } from "@/data/collection";
import { renderCard, requiredCardOrds } from "@/domain/template";
import type { DeckId, NoteId, NoteType, NoteTypeId } from "@/domain/types";
import { useDecks, useNoteTypes } from "@/hooks/useCollection";
import { errorMessage, pluralize } from "@/lib/utils";

export const AddPage = (): JSX.Element => {
  const decks = useDecks();
  const noteTypes = useNoteTypes();
  const [params] = useSearchParams();
  const [deckId, setDeckId] = useState<DeckId | "">((params.get("deck") as DeckId | null) ?? "");
  const [noteTypeId, setNoteTypeId] = useState<NoteTypeId | "">("");
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  useEffect(() => {
    void collection.config().then((cfg) => {
      setDeckId((d) => d || cfg.lastDeckId || "");
      setNoteTypeId((n) => n || cfg.lastNoteTypeId || "");
    });
  }, []);

  useEffect(() => {
    if (!deckId && decks && decks[0]) setDeckId(decks[0].id);
  }, [decks, deckId]);

  const noteType: NoteType | undefined = useMemo(() => noteTypes?.find((n) => n.id === noteTypeId) ?? noteTypes?.[0], [noteTypes, noteTypeId]);

  useEffect(() => {
    if (!noteType) return;
    setFields((f) => (f.length === noteType.fields.length ? f : noteType.fields.map((_x, i) => f[i] ?? "")));
  }, [noteType]);

  const previewNote = useMemo(() => {
    if (!noteType) return null;
    const note = { id: "preview" as NoteId, noteTypeId: noteType.id, fields, tags, sortField: "", createdAt: 0, modifiedAt: 0 };
    const ords = requiredCardOrds(note, noteType);
    return { ords, cards: ords.map((ord) => renderCard({ note, noteType, ord, deckName: decks?.find((d) => d.id === deckId)?.name ?? "", cardName: noteType.templates[ord]?.name ?? `Card ${ord + 1}` })) };
  }, [noteType, fields, tags, decks, deckId]);

  const add = async (): Promise<void> => {
    if (!noteType || !deckId) return;
    try {
      const { cards } = await collection.addNote({ noteTypeId: noteType.id, deckId, fields, tags });
      setAddedCount((c) => c + 1);
      setStatus({ kind: "ok", text: `Added ${pluralize(cards.length, "card")}.` });
      setFields(noteType.fields.map((f, i) => (f.sticky ? (fields[i] ?? "") : "")));
      const first = document.getElementById("field-0");
      if (first instanceof HTMLTextAreaElement) first.focus();
    } catch (err) {
      setStatus({ kind: "error", text: errorMessage(err) });
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void add();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Add</h1>
          {addedCount > 0 ? <span className="text-sm text-muted-foreground">{pluralize(addedCount, "note")} added this session</span> : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="notetype">Type</Label>
            <Select
              id="notetype"
              value={noteType?.id ?? ""}
              onChange={(e) => {
                setNoteTypeId(e.target.value as NoteTypeId);
                setFields([]);
              }}
            >
              {(noteTypes ?? []).map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deck">Deck</Label>
            <Select id="deck" value={deckId} onChange={(e) => setDeckId(e.target.value as DeckId)}>
              {(decks ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {noteType ? <NoteEditor noteType={noteType} fields={fields} onChange={setFields} autoFocus /> : null}
        <TagInput value={tags} onChange={setTags} />

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void add()} disabled={!noteType || !deckId || (previewNote?.ords.length ?? 0) === 0}>
            Add
            <kbd className="ml-1 rounded bg-white/10 px-1.5 text-[10px] font-normal">⌘↵</kbd>
          </Button>
          <Button variant="ghost" className="lg:hidden" onClick={() => setPreview((p) => !p)}>
            <Eye /> {preview ? "Hide" : "Show"} preview
          </Button>
          {status ? (
            <p role="status" className={status.kind === "ok" ? "text-sm text-good" : "text-sm text-destructive"}>
              {status.text}
            </p>
          ) : null}
        </div>
      </div>

      <aside className={`${preview ? "block" : "hidden"} lg:block space-y-3`}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Preview · {pluralize(previewNote?.ords.length ?? 0, "card")}</h2>
        {previewNote && previewNote.cards.length > 0 ? (
          previewNote.cards.map((c, i) => (
            <div key={i} className="glass rounded-xl p-4 space-y-3">
              <CardRenderer html={c.question} css={c.css} className="text-base" />
              <hr className="border-border" />
              <CardRenderer html={c.answer.replace(/^[\s\S]*?<hr id=answer>/, "")} css={c.css} className="text-base text-muted-foreground" />
            </div>
          ))
        ) : (
          <div className="glass rounded-xl p-6 text-sm text-muted-foreground">{noteType?.isCloze ? "Add a cloze deletion with {{c1::…}} to generate a card." : "Fill in the front field to generate a card."}</div>
        )}
      </aside>
    </div>
  );
};
