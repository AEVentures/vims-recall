import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { strToU8, zipSync } from "fflate";
import { Collection } from "./collection";
import { RecallDatabase } from "./db";
import { ApkgError, importApkg } from "./apkg";

let sql: SqlJsStatic;
let col: Collection;
let n = 0;

const DAY = 86_400;
const crt = 1_700_000_000; // collection creation (seconds)

const buildApkg = (opts: { newest?: boolean } = {}): Uint8Array => {
  const db = new sql.Database();
  db.run(`CREATE TABLE col (id integer primary key, crt integer, mod integer, scm integer, ver integer, dty integer, usn integer, ls integer, conf text, models text, decks text, dconf text, tags text);`);
  db.run(`CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld integer, csum integer, flags integer, data text);`);
  db.run(`CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer, mod integer, usn integer, type integer, queue integer, due integer, ivl integer, factor integer, reps integer, lapses integer, left integer, odue integer, odid integer, flags integer, data text);`);
  db.run(`CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);`);
  const models = {
    "1001": { id: 1001, name: "Basic", type: 0, sortf: 0, css: ".card{}", flds: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }], tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}" }] },
    "1002": { id: 1002, name: "Cloze", type: 1, sortf: 0, css: "", flds: [{ name: "Text", ord: 0 }, { name: "Extra", ord: 1 }], tmpls: [{ name: "Cloze", ord: 0, qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}<br>{{Extra}}" }] }
  };
  const decks = { "1": { id: 1, name: "Default" }, "2001": { id: 2001, name: "Spanish::Verbs", desc: "verbs" } };
  db.run(`INSERT INTO col VALUES (1, ${crt}, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')`, [JSON.stringify(models), JSON.stringify(decks)]);
  db.run(`INSERT INTO notes VALUES (1700000000001, 'g1', 1001, 0, 0, ' verb common ', 'hablar\u001fto speak', 'hablar', 0, 0, '')`);
  db.run(`INSERT INTO notes VALUES (1700000000002, 'g2', 1002, 0, 0, '', 'yo {{c1::hablo}} tú {{c2::hablas}}\u001f', 'yo', 0, 0, '')`);
  // review card due 3 days after crt, interval 10, ease 2500
  db.run(`INSERT INTO cards VALUES (1, 1700000000001, 2001, 0, 0, 0, 2, 2, 3, 10, 2500, 4, 1, 0, 0, 0, 0, '')`);
  // two cloze cards, new, suspended second one
  db.run(`INSERT INTO cards VALUES (2, 1700000000002, 2001, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, '')`);
  db.run(`INSERT INTO cards VALUES (3, 1700000000002, 2001, 1, 0, 0, 0, -1, 6, 0, 0, 0, 0, 0, 0, 0, 0, '')`);
  db.run(`INSERT INTO revlog VALUES (1700100000000, 1, 0, 3, 10, 4, 2500, 5000, 1)`);
  const bytes = db.export();
  db.close();
  const files: Record<string, Uint8Array> = opts.newest ? { "collection.anki21b": bytes } : { "collection.anki2": bytes };
  // copy into this realm: jsdom's TextEncoder output fails fflate's instanceof check
  files["media"] = new Uint8Array(strToU8(JSON.stringify({ "0": "pic.png" })));
  files["0"] = new Uint8Array([137, 80, 78, 71]);
  return zipSync(files);
};

beforeAll(async () => {
  sql = await initSqlJs();
});

beforeEach(async () => {
  col = new Collection(new RecallDatabase(`apkg-${Date.now()}-${n++}`));
  await col.ensureInitialized();
});

describe("importApkg", () => {
  it("imports note types, decks, notes, cards, scheduling, revlog and media", async () => {
    const summary = await importApkg(buildApkg(), sql, { keepScheduling: true }, col);
    expect(summary.notes).toBe(2);
    expect(summary.cards).toBe(3);
    expect(summary.revlog).toBe(1);
    expect(summary.media).toBe(1);
    expect(summary.warnings).toEqual([]);

    const decks = await col.listDecks();
    expect(decks.map((d) => d.name)).toContain("Spanish::Verbs");
    const types = await col.listNoteTypes();
    expect(types.find((t) => t.name === "Cloze")?.isCloze).toBe(true);

    const notes = await col.allNotes();
    const hablar = notes.find((x) => x.sortField === "hablar");
    expect(hablar?.tags).toEqual(["common", "verb"]);
    expect(notes.find((x) => x.sortField.startsWith("yo hablo"))).toBeDefined();

    const cards = await col.allCards();
    const review = cards.find((c) => c.type === "review");
    expect(review?.interval).toBe(10);
    expect(review?.ease).toBe(2500);
    expect(review?.lapses).toBe(1);
    const expectedDue = Math.floor((crt * 1000 + 3 * DAY * 1000) / (DAY * 1000));
    expect(Math.abs((review?.due ?? 0) - expectedDue)).toBeLessThanOrEqual(1);
    expect(cards.filter((c) => c.queue === "suspended")).toHaveLength(1);
    expect(await col.getMedia("pic.png")).toBeDefined();
  });

  it("can import everything as new cards", async () => {
    await importApkg(buildApkg(), sql, { keepScheduling: false }, col);
    const cards = await col.allCards();
    expect(cards.every((c) => c.type === "new" && c.queue === "new")).toBe(true);
    expect(await col.allRevlog()).toHaveLength(0);
  });

  it("is idempotent on re-import", async () => {
    await importApkg(buildApkg(), sql, { keepScheduling: true }, col);
    await importApkg(buildApkg(), sql, { keepScheduling: true }, col);
    expect(await col.allNotes()).toHaveLength(2);
    expect(await col.allCards()).toHaveLength(3);
  });

  it("explains the newest compressed format", async () => {
    await expect(importApkg(buildApkg({ newest: true }), sql, { keepScheduling: true }, col)).rejects.toBeInstanceOf(ApkgError);
  });
});
