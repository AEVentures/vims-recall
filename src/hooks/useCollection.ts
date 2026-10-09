import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { collection } from "@/data/collection";
import { seedStarterDeck } from "@/data/seed";
import type { Deck, DeckCounts, DeckId, DeckOptions, NoteType } from "@/domain/types";
import { errorMessage } from "@/lib/utils";

interface BootState {
  ready: boolean;
  error: string | null;
}

let bootPromise: Promise<void> | null = null;

/** Shared across mounts so StrictMode's double effect (and multiple consumers) never seed twice. */
const boot = (): Promise<void> => {
  bootPromise ??= (async () => {
    await collection.ensureInitialized();
    await seedStarterDeck(collection);
  })().catch((err: unknown) => {
    bootPromise = null;
    throw err;
  });
  return bootPromise;
};

export const useBootstrap = (): BootState => {
  const [state, setState] = useState<BootState>({ ready: false, error: null });
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await boot();
        if (active) setState({ ready: true, error: null });
      } catch (err) {
        if (active) setState({ ready: false, error: errorMessage(err) });
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  return state;
};

export const useDecks = (): Deck[] | undefined => useLiveQuery(() => collection.listDecks(), []);

export const useNoteTypes = (): NoteType[] | undefined => useLiveQuery(() => collection.listNoteTypes(), []);

export const useDeckOptionsList = (): DeckOptions[] | undefined => useLiveQuery(() => collection.listDeckOptions(), []);

/** Live deck counts; re-evaluated when cards/revlog change and once a minute as learning cards come due. */
export const useDeckCounts = (): Map<DeckId, DeckCounts> | undefined => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return useLiveQuery(() => collection.allDeckCounts(), [tick]);
};

export const useTags = (): string[] | undefined => useLiveQuery(() => collection.allTags(), []);
