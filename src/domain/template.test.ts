import { describe, expect, it } from "vitest";
import { clozeNumbers, renderCard, renderCloze, requiredCardOrds, stripHtml } from "./template";
import { builtinNoteTypes, BASIC_NOTE_TYPE_ID, BASIC_REVERSED_NOTE_TYPE_ID, CLOZE_NOTE_TYPE_ID } from "./defaults";
import type { Note, NoteId, NoteType } from "./types";

const types = builtinNoteTypes(0);
const byId = (id: string): NoteType => {
  const nt = types.find((t) => t.id === id);
  if (!nt) throw new Error("missing");
  return nt;
};

const note = (noteTypeId: NoteType["id"], fields: string[], tags: string[] = []): Note => ({
  id: "n" as NoteId,
  noteTypeId,
  fields,
  tags,
  sortField: fields[0] ?? "",
  createdAt: 0,
  modifiedAt: 0
});

describe("cloze", () => {
  it("finds distinct cloze numbers", () => {
    expect(clozeNumbers("{{c2::b}} {{c1::a}} {{c1::again::hint}}")).toEqual([1, 2]);
  });
  it("hides only the active cloze on the question", () => {
    const q = renderCloze("The {{c1::mitochondria}} is the {{c2::powerhouse::hint}}", 1, "question");
    expect(q).toContain("[...]");
    expect(q).toContain("powerhouse");
    expect(q).not.toContain("mitochondria");
  });
  it("uses the hint when provided", () => {
    expect(renderCloze("{{c1::Paris::city}}", 1, "question")).toContain("[city]");
  });
  it("reveals the active cloze on the answer", () => {
    expect(renderCloze("{{c1::Paris}}", 1, "answer")).toBe('<span class="cloze">Paris</span>');
  });
});

describe("renderCard", () => {
  it("renders basic front and back with FrontSide", () => {
    const r = renderCard({ note: note(BASIC_NOTE_TYPE_ID, ["Q", "A"]), noteType: byId(BASIC_NOTE_TYPE_ID), ord: 0, deckName: "D", cardName: "Card 1" });
    expect(r.question).toBe("Q");
    expect(r.answer).toBe("Q<hr id=answer>A");
  });
  it("renders the reversed card", () => {
    const r = renderCard({ note: note(BASIC_REVERSED_NOTE_TYPE_ID, ["Q", "A"]), noteType: byId(BASIC_REVERSED_NOTE_TYPE_ID), ord: 1, deckName: "D", cardName: "Card 2" });
    expect(r.question).toBe("A");
  });
  it("renders cloze cards by ordinal", () => {
    const r = renderCard({ note: note(CLOZE_NOTE_TYPE_ID, ["{{c1::one}} {{c2::two}}", "extra"]), noteType: byId(CLOZE_NOTE_TYPE_ID), ord: 1, deckName: "D", cardName: "Cloze" });
    expect(r.question).toBe('one <span class="cloze cloze-hidden">[...]</span>');
    expect(r.answer).toBe('one <span class="cloze">two</span><br>extra');
  });
  it("supports conditional sections and special fields", () => {
    const nt: NoteType = { ...byId(BASIC_NOTE_TYPE_ID), templates: [{ name: "Card 1", ord: 0, qfmt: "{{#Back}}has back{{/Back}}{{^Back}}no back{{/Back}} {{Tags}} {{Deck}}", afmt: "" }] };
    const withBack = renderCard({ note: note(BASIC_NOTE_TYPE_ID, ["Q", "A"], ["t1"]), noteType: nt, ord: 0, deckName: "Deck", cardName: "Card 1" });
    expect(withBack.question).toBe("has back t1 Deck");
    const without = renderCard({ note: note(BASIC_NOTE_TYPE_ID, ["Q", ""]), noteType: nt, ord: 0, deckName: "Deck", cardName: "Card 1" });
    expect(without.question).toBe("no back  Deck");
  });
});

describe("requiredCardOrds", () => {
  it("skips templates whose front is empty", () => {
    expect(requiredCardOrds(note(BASIC_REVERSED_NOTE_TYPE_ID, ["Q", ""]), byId(BASIC_REVERSED_NOTE_TYPE_ID))).toEqual([0]);
    expect(requiredCardOrds(note(BASIC_REVERSED_NOTE_TYPE_ID, ["Q", "A"]), byId(BASIC_REVERSED_NOTE_TYPE_ID))).toEqual([0, 1]);
  });
  it("generates one cloze card per cloze number", () => {
    expect(requiredCardOrds(note(CLOZE_NOTE_TYPE_ID, ["{{c3::x}} {{c1::y}}", ""]), byId(CLOZE_NOTE_TYPE_ID))).toEqual([0, 2]);
  });
  it("strips html for emptiness checks", () => {
    expect(stripHtml("<div><br></div>")).toBe("");
    expect(requiredCardOrds(note(BASIC_NOTE_TYPE_ID, ["<br>", "A"]), byId(BASIC_NOTE_TYPE_ID))).toEqual([]);
  });
});
