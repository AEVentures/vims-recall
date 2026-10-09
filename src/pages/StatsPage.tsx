import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Select } from "@/components/ui";
import { collection } from "@/data/collection";
import { countCards, easeHistogram, forecast, retention, reviewHistory, streak, summarizeToday, type Bucket } from "@/domain/stats";
import { dayStart } from "@/domain/time";
import type { DeckId } from "@/domain/types";
import { useDecks } from "@/hooks/useCollection";

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element => (
  <div className="glass rounded-xl p-4">
    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
  </div>
);

const Bars = ({ data, color, title }: { data: Bucket[]; color: string; title: string }): JSX.Element => {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="glass rounded-xl p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="flex h-36 items-end gap-[2px]" role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
        {data.map((d, i) => (
          <div key={i} className="group relative flex-1 min-w-0">
            <div className="w-full rounded-t-sm transition-all" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0, background: color }} />
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-card px-1.5 py-0.5 text-[10px] tabular-nums shadow group-hover:block">{d.label}: {d.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
};

const pct = (v: number | null): string => (v === null ? "—" : `${Math.round(v * 100)}%`);

export const StatsPage = (): JSX.Element => {
  const decks = useDecks();
  const [deckId, setDeckId] = useState<DeckId | "all">("all");
  const data = useLiveQuery(async () => {
    const [cards, logs, cfg, allDecks] = await Promise.all([collection.allCards(), collection.allRevlog(), collection.config(), collection.listDecks()]);
    const now = Date.now();
    const today = await collection.today(now);
    const scopeDeck = deckId === "all" ? undefined : allDecks.find((d) => d.id === deckId);
    const ids = scopeDeck ? new Set(await collection.deckAndChildrenIds(scopeDeck)) : null;
    const scopedCards = ids ? cards.filter((c) => ids.has(c.deckId)) : cards;
    const scopedLogs = ids ? logs.filter((l) => ids.has(l.deckId)) : logs;
    return { cards: scopedCards, logs: scopedLogs, today, dayStartMs: dayStart(now, cfg.rolloverHour), createdAt: cfg.createdAt };
  }, [deckId]);

  const derived = useMemo(() => {
    if (!data) return null;
    const daysActive = Math.max(1, Math.ceil((Date.now() - data.createdAt) / 86_400_000));
    return {
      today: summarizeToday(data.logs, data.dayStartMs),
      forecast: forecast(data.cards, data.today, 30),
      history: reviewHistory(data.logs, data.dayStartMs, 30),
      counts: countCards(data.cards),
      retention: retention(data.logs),
      ease: easeHistogram(data.cards),
      streak: streak(data.logs, data.dayStartMs),
      avgPerDay: data.logs.length / daysActive
    };
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Statistics</h1>
        <Select className="w-56" value={deckId} onChange={(e) => setDeckId(e.target.value as DeckId | "all")} aria-label="Scope">
          <option value="all">Whole collection</option>
          {(decks ?? []).map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </Select>
      </div>

      {!derived ? (
        <div className="grid gap-3 sm:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-muted/40 animate-pulse" />)}
        </div>
      ) : (
        <>
          <section className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            <Stat label="Studied today" value={String(derived.today.reviews)} sub={`${derived.today.minutes} min · ${derived.today.newLearned} new`} />
            <Stat label="Correct today" value={pct(derived.today.correctRate)} sub="excluding new cards" />
            <Stat label="Streak" value={`${derived.streak}d`} sub={`${derived.avgPerDay.toFixed(1)} reviews/day avg`} />
            <Stat label="Total cards" value={String(derived.counts.total)} sub={`${derived.counts.mature} mature · ${derived.counts.young} young`} />
          </section>

          <section className="grid gap-3 lg:grid-cols-2">
            <Bars title="Forecast · reviews due, next 30 days" data={derived.forecast} color="hsl(var(--good))" />
            <Bars title="Reviews · past 30 days" data={derived.history} color="hsl(var(--primary))" />
          </section>

          <section className="grid gap-3 lg:grid-cols-3">
            <div className="glass rounded-xl p-4">
              <h3 className="mb-3 text-sm font-semibold">Card counts</h3>
              <dl className="space-y-1.5 text-sm">
                {[
                  ["New", derived.counts.newCount, "hsl(var(--easy))"],
                  ["Learning", derived.counts.learning, "hsl(var(--again))"],
                  ["Young (<21d)", derived.counts.young, "hsl(var(--good) / 0.6)"],
                  ["Mature (≥21d)", derived.counts.mature, "hsl(var(--good))"],
                  ["Suspended", derived.counts.suspended, "hsl(var(--hard))"],
                  ["Buried", derived.counts.buried, "hsl(var(--muted-foreground))"]
                ].map(([label, value, color]) => (
                  <div key={String(label)} className="flex items-center justify-between">
                    <dt className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: String(color) }} />{label}</dt>
                    <dd className="tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="glass rounded-xl p-4">
              <h3 className="mb-3 text-sm font-semibold">True retention</h3>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt>Young cards</dt><dd className="tabular-nums">{pct(derived.retention.young)}</dd></div>
                <div className="flex justify-between"><dt>Mature cards</dt><dd className="tabular-nums">{pct(derived.retention.mature)}</dd></div>
                <div className="flex justify-between font-medium"><dt>Overall</dt><dd className="tabular-nums">{pct(derived.retention.overall)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">Share of review answers that were Hard, Good, or Easy. Aim for 85–95%.</p>
            </div>
            {derived.ease.length > 0 ? <Bars title="Ease distribution" data={derived.ease} color="hsl(var(--hard))" /> : <div className="glass rounded-xl p-4 text-sm text-muted-foreground">Ease distribution appears once cards graduate to review.</div>}
          </section>
        </>
      )}
    </div>
  );
};
