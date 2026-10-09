import { beforeEach, describe, expect, it } from "vitest";
import { Collection } from "./collection";
import { RecallDatabase } from "./db";
import { exportBackupJson, importBackup, importDelimitedText, parseDelimited } from "./importExport";
import { BASIC_NOTE_TYPE_ID } from "@/domain/defaults";

let col: Collection;
let n = 0;
beforeEach(async () => {
  col = new Collection(new RecallDatabase(`ie-${Date.now()}-${n++}`));
  await col.ensureInitialized();
});

describe("parseDelimited", () => {
  it("handles quotes, embedded delimiters and newlines", () => {
    expect(parseDelimited('a,b\n"c,d","e""f"\n"multi\nline",x\n', ",")).toEqual([
      ["a", "b"],
      ["c,d", 'e"f'],
      ["multi\nline", "x"]
    ]);
  });
  it("skips blank lines", () => {
    expect(parseDelimited("a\tb\n\n\nc\td", "\t")).toEqual([
      ["a", "b"],
      ["c", "d"]
    ]);
  });
});

describe("delimited import", () => {
  it("creates notes with tags from a column and escapes html when asked", async () => {
    const deck = await col.createDeck("Imported");
    const result = await importDelimitedText("front\tback\ttags\n<b>hi</b>\tthere\tgreet\nq2\ta2\t", { deckId: deck.id, noteTypeId: BASIC_NOTE_TYPE_ID, delimiter: "tab", skipHeader: true, tagsColumn: 3, allowHtml: false }, col);
    expect(result.added).toBe(2);
    const notes = await col.allNotes();
    expect(notes.find((x) => x.tags.includes("greet"))?.fields[0]).toBe("&lt;b&gt;hi&lt;/b&gt;");
  });
});

describe("backup round trip", () => {
  it("restores decks, notes, cards and review history", async () => {
    const deck = await col.createDeck("Round::Trip");
    const { cards } = await col.addNote({ noteTypeId: BASIC_NOTE_TYPE_ID, deckId: deck.id, fields: ["Q", "A"], tags: ["t"] });
    const card = cards[0];
    if (!card) throw new Error("no card");
    await col.answerCard(card.id, 3, 1000);
    const text = await exportBackupJson(col);

    const target = new Collection(new RecallDatabase(`ie-target-${Date.now()}`));
    await target.ensureInitialized();
    const summary = await importBackup(text, "merge", target);
    expect(summary.notes).toBe(1);
    expect((await target.allNotes())[0]?.tags).toEqual(["t"]);
    expect((await target.getCard(card.id)).reps).toBe(1);
    expect(await target.allRevlog()).toHaveLength(1);
    expect((await target.listDecks()).map((d) => d.name)).toContain("Round::Trip");
  });
});
