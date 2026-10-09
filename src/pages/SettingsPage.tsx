import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Download, FileUp, Trash2, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Label, Select, Switch } from "@/components/ui";
import { collection } from "@/data/collection";
import { exportBackup, exportDeckAsText, importBackup, importDelimitedText, type TextImportOptions } from "@/data/importExport";
import type { DeckId, NoteTypeId } from "@/domain/types";
import { useDecks, useNoteTypes } from "@/hooks/useCollection";
import { downloadBlob, errorMessage } from "@/lib/utils";

const stamp = (): string => new Date().toISOString().slice(0, 10);

export const SettingsPage = (): JSX.Element => {
  const decks = useDecks();
  const noteTypes = useNoteTypes();
  const cfg = useLiveQuery(() => collection.config(), []);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const apkgInput = useRef<HTMLInputElement>(null);
  const [keepScheduling, setKeepScheduling] = useState(true);
  const [textOpts, setTextOpts] = useState<Omit<TextImportOptions, "deckId" | "noteTypeId">>({ delimiter: "tab", skipHeader: false, tagsColumn: null, allowHtml: true });
  const [textDeck, setTextDeck] = useState<DeckId | "">("");
  const [textType, setTextType] = useState<NoteTypeId | "">("");
  const [exportDeck, setExportDeck] = useState<DeckId | "">("");
  const [busy, setBusy] = useState(false);

  const run = async (label: string, fn: () => Promise<string>): Promise<void> => {
    setBusy(true);
    try {
      setStatus({ kind: "ok", text: await fn() });
    } catch (err) {
      setStatus({ kind: "error", text: `${label}: ${errorMessage(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const onBackupFile = async (file: File): Promise<void> => {
    const replace = window.confirm("Replace the current collection with this backup?\n\nOK = replace everything · Cancel = merge into existing data");
    await run("Restore", async () => {
      const s = await importBackup(await file.text(), replace ? "replace" : "merge");
      return `Restored ${s.decks} decks, ${s.notes} notes, ${s.cards} cards, ${s.revlog} reviews.`;
    });
  };

  const onApkgFile = async (file: File): Promise<void> => {
    await run("Anki import", async () => {
      const { importApkgFile } = await import("@/data/apkgBrowser");
      const s = await importApkgFile(file, { keepScheduling });
      const warn = s.warnings.length > 0 ? ` ${s.warnings.length} warning(s): ${s.warnings.slice(0, 3).join(" ")}` : "";
      return `Imported ${s.decks} decks, ${s.noteTypes} note types, ${s.notes} notes, ${s.cards} cards, ${s.revlog} reviews, ${s.media} media files.${warn}`;
    });
  };

  const onTextFile = async (file: File): Promise<void> => {
    const deckId = textDeck || decks?.[0]?.id;
    const noteTypeId = textType || noteTypes?.[0]?.id;
    if (!deckId || !noteTypeId) return;
    await run("Import", async () => {
      const r = await importDelimitedText(await file.text(), { ...textOpts, deckId, noteTypeId });
      return `Imported ${r.added} notes${r.skipped ? `, skipped ${r.skipped}` : ""}.${r.errors.length ? ` ${r.errors.join(" ")}` : ""}`;
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {status ? (
        <p role="status" className={status.kind === "ok" ? "glass rounded-md p-3 text-sm text-good" : "glass rounded-md p-3 text-sm text-destructive"}>
          {status.text}
        </p>
      ) : null}

      <section className="glass rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Backup</h2>
        <p className="text-sm text-muted-foreground">Everything lives in this browser. Export a backup regularly; it includes scheduling, review history, and media.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void run("Export", async () => { downloadBlob(await exportBackup(), `vims-recall-backup-${stamp()}.json`); return "Backup downloaded."; })}>
            <Download /> Export backup
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => backupInput.current?.click()}>
            <Upload /> Restore backup
          </Button>
          <input ref={backupInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onBackupFile(f); e.target.value = ""; }} />
        </div>
      </section>

      <section className="glass rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Import from Anki (.apkg)</h2>
        <p className="text-sm text-muted-foreground">
          Brings over note types, decks, notes, media, and—optionally—your scheduling and review history. In Anki, use File → Export → Anki Deck Package and tick <em>Support older Anki versions</em>.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => apkgInput.current?.click()}>
            <FileUp /> Choose .apkg…
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <Switch label="Keep scheduling" checked={keepScheduling} onCheckedChange={setKeepScheduling} /> Keep scheduling and history
          </label>
        </div>
        <input ref={apkgInput} type="file" accept=".apkg,.colpkg,application/zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onApkgFile(f); e.target.value = ""; }} />
      </section>

      <section className="glass rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Import text</h2>
        <p className="text-sm text-muted-foreground">Tab- or comma-separated files, one note per line, columns in field order. Anki text exports work directly.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="imp-deck">Into deck</Label>
            <Select id="imp-deck" value={textDeck || decks?.[0]?.id || ""} onChange={(e) => setTextDeck(e.target.value as DeckId)}>
              {(decks ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-type">Note type</Label>
            <Select id="imp-type" value={textType || noteTypes?.[0]?.id || ""} onChange={(e) => setTextType(e.target.value as NoteTypeId)}>
              {(noteTypes ?? []).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-delim">Delimiter</Label>
            <Select id="imp-delim" value={textOpts.delimiter} onChange={(e) => setTextOpts((o) => ({ ...o, delimiter: e.target.value as TextImportOptions["delimiter"] }))}>
              <option value="tab">Tab</option>
              <option value="comma">Comma</option>
              <option value="semicolon">Semicolon</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-tags" hint="1-based, blank for none">Tags column</Label>
            <Select id="imp-tags" value={textOpts.tagsColumn ?? ""} onChange={(e) => setTextOpts((o) => ({ ...o, tagsColumn: e.target.value ? Number(e.target.value) : null }))}>
              <option value="">None</option>
              {[1, 2, 3, 4, 5, 6].map((i) => <option key={i} value={i}>Column {i}</option>)}
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-sm">First row is a header</span>
            <Switch label="First row is a header" checked={textOpts.skipHeader} onCheckedChange={(v) => setTextOpts((o) => ({ ...o, skipHeader: v }))} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-sm">Allow HTML in fields</span>
            <Switch label="Allow HTML in fields" checked={textOpts.allowHtml} onCheckedChange={(v) => setTextOpts((o) => ({ ...o, allowHtml: v }))} />
          </div>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => textInput.current?.click()}>
          <FileUp /> Choose file…
        </Button>
        <input ref={textInput} type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onTextFile(f); e.target.value = ""; }} />
      </section>

      <section className="glass rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Export deck as text</h2>
        <div className="flex flex-wrap gap-2">
          <Select className="w-64" value={exportDeck} onChange={(e) => setExportDeck(e.target.value as DeckId)} aria-label="Deck to export">
            <option value="">Choose deck…</option>
            {(decks ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Button variant="secondary" disabled={!exportDeck || busy} onClick={() => void run("Export", async () => { if (!exportDeck) return ""; const d = await collection.getDeck(exportDeck); downloadBlob(await exportDeckAsText(exportDeck), `${d.name.replace(/::/g, "-")}.txt`); return "Deck exported."; })}>
            <Download /> Export
          </Button>
        </div>
      </section>

      <section className="glass rounded-xl p-5 space-y-4">
        <h2 className="font-semibold">Scheduling</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rollover" hint="when the next day starts">Day rollover</Label>
            <Select id="rollover" value={cfg?.rolloverHour ?? 4} onChange={(e) => void collection.updateConfig({ rolloverHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_v, h) => <option key={h} value={h}>{h === 0 ? "Midnight" : h < 12 ? `${h} am` : h === 12 ? "Noon" : `${h - 12} pm`}</option>)}
            </Select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage fields and card templates under <Link to="/notetypes" className="text-primary underline-offset-4 hover:underline">Note types</Link>.
        </p>
      </section>

      <section className="glass rounded-xl border-destructive/30 p-5 space-y-3">
        <h2 className="font-semibold text-destructive">Danger zone</h2>
        <Button variant="destructive" disabled={busy} onClick={() => { if (window.confirm("Delete ALL decks, notes, cards, and history in this browser? Export a backup first.") && window.confirm("This cannot be undone. Continue?")) void run("Reset", async () => { await collection.wipe(); await collection.ensureInitialized(); return "Collection reset."; }); }}>
          <Trash2 /> Reset collection
        </Button>
      </section>
    </div>
  );
};
