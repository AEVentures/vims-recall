import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useSearchParams } from "react-router-dom";
import { Button, Input, Select } from "@/components/ui";
import { EditNoteDialog } from "@/components/EditNoteDialog";
import { collection } from "@/data/collection";
import { buildRows, filterRows, type BrowserRow } from "@/data/search";
import { formatInterval } from "@/domain/time";
import type { CardId, DeckId, NoteId } from "@/domain/types";
import { useDecks } from "@/hooks/useCollection";
import { cn, pluralize } from "@/lib/utils";

type SortKey = "sortField" | "deck" | "due" | "interval" | "ease" | "reps" | "lapses" | "created";

const dueLabel = (row: BrowserRow, today: number): string => {
  const c = row.card;
  if (c.queue === "suspended") return "(suspended)";
  if (c.queue === "buried") return "(buried)";
  if (c.queue === "new") return `New #${c.due}`;
  if (c.queue === "learn") return new Date(c.due).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const delta = c.due - today;
  return delta <= 0 ? (delta === 0 ? "Today" : `${-delta}d overdue`) : `in ${delta}d`;
};

const sorters: Record<SortKey, (a: BrowserRow, b: BrowserRow) => number> = {
  sortField: (a, b) => a.sortField.localeCompare(b.sortField),
  deck: (a, b) => a.deck.name.localeCompare(b.deck.name),
  due: (a, b) => a.card.due - b.card.due,
  interval: (a, b) => a.card.interval - b.card.interval,
  ease: (a, b) => a.card.ease - b.card.ease,
  reps: (a, b) => a.card.reps - b.card.reps,
  lapses: (a, b) => a.card.lapses - b.card.lapses,
  created: (a, b) => a.note.createdAt - b.note.createdAt
};

export const BrowsePage = (): JSX.Element => {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [asc, setAsc] = useState(false);
  const [selected, setSelected] = useState<Set<CardId>>(new Set());
  const [editing, setEditing] = useState<NoteId | null>(null);
  const [moveTo, setMoveTo] = useState<DeckId | "">("");
  const decks = useDecks();
  const today = useLiveQuery(() => collection.today(), []) ?? 0;

  const rows = useLiveQuery(async () => {
    const [cards, notes, noteTypes, allDecks] = await Promise.all([collection.allCards(), collection.allNotes(), collection.listNoteTypes(), collection.listDecks()]);
    return buildRows(cards, notes, noteTypes, allDecks);
  }, []);

  useEffect(() => {
    const q = params.get("q") ?? "";
    setQuery(q);
  }, [params]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const list = filterRows(rows, query, today, Date.now());
    list.sort(sorters[sortKey]);
    if (!asc) list.reverse();
    return list;
  }, [rows, query, today, sortKey, asc]);

  const ids = useMemo(() => filtered.map((r) => r.card.id), [filtered]);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const selectedIds = [...selected].filter((id) => ids.includes(id));

  const toggleAll = (): void => setSelected(allSelected ? new Set() : new Set(ids));
  const toggle = (id: CardId): void =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const act = async (fn: (ids: CardId[]) => Promise<void>): Promise<void> => {
    if (selectedIds.length === 0) return;
    await fn(selectedIds);
    setSelected(new Set());
  };

  const deleteSelected = async (): Promise<void> => {
    const noteIds = [...new Set(filtered.filter((r) => selected.has(r.card.id)).map((r) => r.note.id))];
    if (!window.confirm(`Delete ${pluralize(noteIds.length, "note")} and all of their cards?`)) return;
    await collection.deleteNotes(noteIds);
    setSelected(new Set());
  };

  const header = (key: SortKey, label: string, className?: string): JSX.Element => (
    <th scope="col" className={cn("px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground", className)}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => {
          if (sortKey === key) setAsc((a) => !a);
          else {
            setSortKey(key);
            setAsc(true);
          }
        }}
      >
        {label}
        {sortKey === key ? <span aria-hidden>{asc ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Browse</h1>
          <p className="text-sm text-muted-foreground">
            {rows ? `${pluralize(filtered.length, "card")} shown` : "Loading…"}
            {selectedIds.length > 0 ? ` · ${selectedIds.length} selected` : ""}
          </p>
        </div>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(query ? { q: query } : {});
        }}
      >
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Search… e.g. deck:Spanish tag:verb is:due -is:suspended "exact phrase" prop:lapses>3' aria-label="Search cards" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {selectedIds.length > 0 ? (
        <div className="glass flex flex-wrap items-center gap-2 rounded-xl p-2">
          <Button size="sm" variant="secondary" onClick={() => void act((i) => collection.setSuspended(i, true))}>Suspend</Button>
          <Button size="sm" variant="secondary" onClick={() => void act((i) => collection.setSuspended(i, false))}>Unsuspend</Button>
          <Button size="sm" variant="secondary" onClick={() => void act((i) => collection.forgetCards(i))}>Forget</Button>
          <Button size="sm" variant="secondary" onClick={() => { const d = window.prompt("Due in how many days?", "0"); if (d !== null) void act((i) => collection.setDueDate(i, Number(d))); }}>Set due date</Button>
          <div className="flex items-center gap-1">
            <Select className="h-9 w-44" value={moveTo} onChange={(e) => setMoveTo(e.target.value as DeckId)} aria-label="Move to deck">
              <option value="">Move to deck…</option>
              {(decks ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" disabled={!moveTo} onClick={() => void act((i) => collection.moveCards(i, moveTo as DeckId))}>Move</Button>
          </div>
          <Button size="sm" variant="destructive" className="ml-auto" onClick={() => void deleteSelected()}>Delete notes</Button>
        </div>
      ) : null}

      <div className="glass overflow-x-auto rounded-xl">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="border-b border-white/5">
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-[hsl(var(--primary))]" />
              </th>
              {header("sortField", "Sort field", "w-[40%]")}
              {header("deck", "Deck")}
              {header("due", "Due")}
              {header("interval", "Interval")}
              {header("ease", "Ease")}
              {header("reps", "Reps")}
              {header("lapses", "Lapses")}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((row) => (
              <tr
                key={row.card.id}
                className={cn("cursor-pointer border-b border-white/5 last:border-0 hover:bg-accent/40", selected.has(row.card.id) && "bg-primary/10", row.card.queue === "suspended" && "text-hard/80", row.card.queue === "buried" && "text-muted-foreground")}
                onClick={() => setEditing(row.note.id)}
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label="Select card" checked={selected.has(row.card.id)} onChange={() => toggle(row.card.id)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                </td>
                <td className="max-w-0 truncate px-3 py-2">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full align-middle" style={{ background: row.card.type === "new" ? "hsl(var(--easy))" : row.card.type === "review" ? "hsl(var(--good))" : "hsl(var(--again))" }} aria-hidden />
                  {row.sortField || row.questionText || "(empty)"}
                  {row.note.tags.length > 0 ? <span className="ml-2 text-xs text-muted-foreground">{row.note.tags.join(" ")}</span> : null}
                </td>
                <td className="truncate px-3 py-2 text-muted-foreground">{row.deck.name}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dueLabel(row, today)}</td>
                <td className="px-3 py-2 tabular-nums">{row.card.interval > 0 ? formatInterval(row.card.interval) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{row.card.ease > 0 ? `${Math.round(row.card.ease / 10)}%` : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{row.card.reps}</td>
                <td className="px-3 py-2 tabular-nums">{row.card.lapses}</td>
              </tr>
            ))}
            {rows && filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">No cards match.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {filtered.length > 500 ? <p className="px-3 py-2 text-xs text-muted-foreground">Showing first 500 of {filtered.length}. Refine your search to see more.</p> : null}
      </div>

      {editing ? <EditNoteDialog noteId={editing} open onOpenChange={(o) => !o && setEditing(null)} /> : null}
    </div>
  );
};
