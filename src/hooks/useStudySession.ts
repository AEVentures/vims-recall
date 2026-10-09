import { useCallback, useEffect, useRef, useState } from "react";
import { collection } from "@/data/collection";
import { previewIntervals } from "@/domain/scheduler";
import { renderCard, type RenderedCard } from "@/domain/template";
import type { Card, Deck, DeckCounts, DeckId, DeckOptions, IntervalPreview, Note, NoteType, Rating } from "@/domain/types";
import { errorMessage } from "@/lib/utils";

export interface StudyItem {
  readonly card: Card;
  readonly note: Note;
  readonly noteType: NoteType;
  readonly deck: Deck;
  readonly rendered: RenderedCard;
  readonly preview: IntervalPreview;
}

interface UndoEntry {
  readonly card: Card;
  readonly logTime: number;
}

export interface StudySession {
  readonly deck: Deck | null;
  readonly options: DeckOptions | null;
  readonly counts: DeckCounts;
  readonly item: StudyItem | null;
  readonly answerShown: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly finished: boolean;
  readonly reviewedThisSession: number;
  readonly canUndo: boolean;
  showAnswer: () => void;
  answer: (rating: Rating) => Promise<void>;
  undo: () => Promise<void>;
  bury: () => Promise<void>;
  suspend: () => Promise<void>;
  refresh: () => Promise<void>;
}

const EMPTY: DeckCounts = { newCount: 0, learnCount: 0, reviewCount: 0 };

export const useStudySession = (deckId: DeckId | undefined): StudySession => {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [options, setOptions] = useState<DeckOptions | null>(null);
  const [counts, setCounts] = useState<DeckCounts>(EMPTY);
  const [item, setItem] = useState<StudyItem | null>(null);
  const [answerShown, setAnswerShown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const undoStack = useRef<UndoEntry[]>([]);
  const shownAt = useRef<number>(Date.now());
  const busy = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (!deckId) return;
    setLoading(true);
    try {
      const now = Date.now();
      const d = await collection.getDeck(deckId);
      const opts = await collection.getDeckOptions(d.optionsId);
      const c = await collection.deckCounts(deckId, now);
      const next = await collection.nextCard(deckId, now);
      setDeck(d);
      setOptions(opts);
      setCounts(c);
      if (!next) {
        setItem(null);
        setFinished(true);
      } else {
        const note = await collection.getNote(next.noteId);
        const noteType = await collection.getNoteType(note.noteTypeId);
        const cardDeck = await collection.getDeck(next.deckId);
        const cardOpts = await collection.getDeckOptions(cardDeck.optionsId);
        const today = await collection.today(now);
        const cardName = noteType.isCloze ? `Cloze ${next.ord + 1}` : (noteType.templates[next.ord]?.name ?? `Card ${next.ord + 1}`);
        setItem({
          card: next,
          note,
          noteType,
          deck: cardDeck,
          rendered: renderCard({ note, noteType, ord: next.ord, deckName: cardDeck.name, cardName }),
          preview: previewIntervals(next, cardOpts, { now, today, random: () => 0.5 })
        });
        setFinished(false);
      }
      setAnswerShown(false);
      shownAt.current = Date.now();
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    void load();
  }, [load]);

  const showAnswer = useCallback(() => setAnswerShown(true), []);

  const answer = useCallback(
    async (rating: Rating): Promise<void> => {
      if (!item || busy.current) return;
      busy.current = true;
      try {
        const now = Date.now();
        await collection.answerCard(item.card.id, rating, now - shownAt.current, now);
        undoStack.current.push({ card: item.card, logTime: now });
        if (undoStack.current.length > 50) undoStack.current.shift();
        setReviewed((r) => r + 1);
        await load();
      } finally {
        busy.current = false;
      }
    },
    [item, load]
  );

  const undo = useCallback(async (): Promise<void> => {
    const last = undoStack.current.pop();
    if (!last) return;
    await collection.undoLastAnswer(last.card, last.logTime);
    setReviewed((r) => Math.max(0, r - 1));
    await load();
  }, [load]);

  const bury = useCallback(async (): Promise<void> => {
    if (!item) return;
    await collection.buryCards([item.card.id]);
    await load();
  }, [item, load]);

  const suspend = useCallback(async (): Promise<void> => {
    if (!item) return;
    await collection.setSuspended([item.card.id], true);
    await load();
  }, [item, load]);

  return { deck, options, counts, item, answerShown, loading, error, finished, reviewedThisSession: reviewed, canUndo: undoStack.current.length > 0, showAnswer, answer, undo, bury, suspend, refresh: load };
};
