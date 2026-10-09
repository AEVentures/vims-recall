import type { Note, NoteType } from "./types";

export interface RenderContext {
  readonly note: Note;
  readonly noteType: NoteType;
  /** template ordinal for standard notes, cloze number - 1 for cloze notes */
  readonly ord: number;
  readonly deckName: string;
  readonly cardName: string;
}

export interface RenderedCard {
  readonly question: string;
  readonly answer: string;
  readonly css: string;
}

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export const stripHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Plain text with HTML removed and cloze markers collapsed to their content (for sort fields and search). */
export const plainText = (html: string): string => stripHtml(html.replace(CLOZE_RE, (_m, _n: string, content: string) => content));

/** Distinct cloze numbers present in a field (1-based). */
export const clozeNumbers = (text: string): number[] => {
  const nums = new Set<number>();
  for (const match of text.matchAll(CLOZE_RE)) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
};

export const renderCloze = (text: string, clozeNumber: number, side: "question" | "answer"): string =>
  text.replace(CLOZE_RE, (_m, numStr: string, content: string, hint: string | undefined) => {
    const n = Number(numStr);
    if (n !== clozeNumber) return content;
    if (side === "answer") return `<span class="cloze">${content}</span>`;
    const placeholder = hint && hint.length > 0 ? hint : "...";
    return `<span class="cloze cloze-hidden">[${placeholder}]</span>`;
  });

const fieldMap = (ctx: RenderContext): Map<string, string> => {
  const map = new Map<string, string>();
  ctx.noteType.fields.forEach((f, i) => map.set(f.name, ctx.note.fields[i] ?? ""));
  map.set("Tags", ctx.note.tags.join(" "));
  map.set("Type", ctx.noteType.name);
  map.set("Deck", ctx.deckName);
  map.set("Subdeck", ctx.deckName.split("::").pop() ?? ctx.deckName);
  map.set("Card", ctx.cardName);
  return map;
};

const applyFilters = (filters: readonly string[], raw: string, ctx: RenderContext, side: "question" | "answer"): string => {
  let value = raw;
  for (const filter of [...filters].reverse()) {
    switch (filter) {
      case "cloze":
        value = renderCloze(value, ctx.ord + 1, side);
        break;
      case "text":
        value = stripHtml(value);
        break;
      case "hint": {
        const plain = stripHtml(value);
        value = plain.length === 0 ? "" : `<details class="hint"><summary>Show hint</summary>${value}</details>`;
        break;
      }
      case "type":
        value = `<input class="typeans" type="text" placeholder="Type answer" data-answer="${stripHtml(value).replace(/"/g, "&quot;")}">`;
        break;
      default:
        break;
    }
  }
  return value;
};

const SECTION_RE = /\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
const FIELD_RE = /\{\{([^}]+)\}\}/g;

const resolveSections = (template: string, fields: Map<string, string>): string => {
  let out = template;
  let changed = true;
  while (changed) {
    changed = false;
    out = out.replace(SECTION_RE, (_m, kind: string, name: string, body: string) => {
      changed = true;
      const present = stripHtml(fields.get(name.trim()) ?? "").length > 0;
      return (kind === "#") === present ? body : "";
    });
  }
  return out;
};

export const renderTemplate = (template: string, ctx: RenderContext, side: "question" | "answer", frontSide = ""): string => {
  const fields = fieldMap(ctx);
  const withSections = resolveSections(template, fields);
  return withSections.replace(FIELD_RE, (_m, expr: string) => {
    const parts = expr.split(":").map((p) => p.trim());
    const name = parts[parts.length - 1] ?? "";
    const filters = parts.slice(0, -1);
    if (name === "FrontSide") return frontSide;
    const raw = fields.get(name);
    if (raw === undefined) return `<span class="missing-field">{unknown field ${name}}</span>`;
    return applyFilters(filters, raw, ctx, side);
  });
};

export const renderCard = (ctx: RenderContext): RenderedCard => {
  const template = ctx.noteType.isCloze ? ctx.noteType.templates[0] : ctx.noteType.templates[ctx.ord];
  if (!template) return { question: "", answer: "", css: ctx.noteType.css };
  const question = renderTemplate(template.qfmt, ctx, "question");
  const answer = renderTemplate(template.afmt, ctx, "answer", question);
  return { question, answer, css: ctx.noteType.css };
};

/**
 * Which card ordinals a note should have, given its note type and field contents.
 * Standard: a template yields a card when its rendered question is non-empty.
 * Cloze: one card per distinct cloze number in any field referenced by the cloze filter.
 */
export const requiredCardOrds = (note: Note, noteType: NoteType): number[] => {
  if (noteType.isCloze) {
    const nums = new Set<number>();
    for (const f of note.fields) clozeNumbers(f).forEach((n) => nums.add(n));
    return [...nums].sort((a, b) => a - b).map((n) => n - 1);
  }
  const base: RenderContext = { note, noteType, ord: 0, deckName: "", cardName: "" };
  return noteType.templates
    .filter((t) => stripHtml(renderTemplate(t.qfmt, { ...base, ord: t.ord, cardName: t.name }, "question")).length > 0)
    .map((t) => t.ord);
};
