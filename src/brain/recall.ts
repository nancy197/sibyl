/**
 * Episodic recall. At lock time Sibyl describes the situation in words, for example
 *   "5m BTC, low volatility, asia session: council far above the market; market near a coin flip"
 * asks Walrus Memory for the most similar past episodes (semantic search), and counts how often
 * the council was right when it disagreed with the market the same way. That track record
 * moves the trade threshold for this one event: trust the disagreement more, or less.
 */
import { one, run } from '../db.js';
import type { Event, Horizon } from '../events.js';
import { clamp } from '../math.js';
import { isEnsemble, marketVoiceFor, memoryEnsemble, type VoiceP } from '../scoring.js';
import { recallMemories } from './memwal.js';
import { memoryData, MEMORY_SCHEMA, NS } from './schema.js';

/** Ask for more than we use: some hits are other horizons or the other side of the market. */
const RECALL_LIMIT = 20;
const MAX_MATCHES = 10;
/** Fewer similar episodes than this is anecdote, not evidence. */
const MIN_MATCHES = 5;
/** Below this gap the council has no view against the market. */
const AGREE_GAP = 0.02;
const FAR_GAP = 0.06;
/** Threshold change per unit of hit rate away from a coin flip (0.8 hit rate -> -0.03)... */
const RECALL_SENSITIVITY = 0.1;
/** ...within these bounds, so recall nudges the learned policy rather than replacing it. */
const ADJUST_RANGE: [number, number] = [-0.02, 0.04];

export type Situation = {
  eventId: string;
  horizon: Horizon;
  marketVoice: string;
  market: number;
  signal: number;
  gap: number;
  description: string;
};

/** Stored with each episode so later recalls can score the council's call. */
export type EpisodeSituation = { description: string; gap: number; councilRight: boolean | null };

type EpisodeRecord = {
  kind: 'episode';
  v: number;
  eventId: string;
  horizon: Horizon;
  situation?: EpisodeSituation;
};

export type Match = { eventId: string; councilRight: boolean; text: string };
export type Evidence = { recalled: number; hits: number; adjustment: number; matches: Match[] };

function gapWords(gap: number): string {
  if (Math.abs(gap) < AGREE_GAP) return 'council agrees with the market';
  const side = gap > 0 ? 'above' : 'below';
  return Math.abs(gap) < FAR_GAP
    ? `council slightly ${side} the market`
    : `council far ${side} the market`;
}

function levelWords(market: number): string {
  if (market > 0.65) return 'market expects up';
  if (market < 0.35) return 'market expects down';
  return 'market near a coin flip';
}

/** The council's independent view against the venue's own price, in words for recall. */
export function describeSituation(e: Event, ctx: string, locked: VoiceP[]): Situation | null {
  const marketVoice = marketVoiceFor(e.source);
  const market = locked.find((f) => f.voice === marketVoice)?.p;
  const signal = memoryEnsemble(
    ctx,
    locked.filter((f) => !isEnsemble(f.voice)),
    marketVoice,
  );
  if (market === undefined || signal === null) return null;
  const [, regime, session] = ctx.split('/');
  const gap = signal - market;
  const description = `${e.horizon} BTC, ${regime} volatility, ${session} session: ${gapWords(gap)}; ${levelWords(market)}`;
  return { eventId: e.id, horizon: e.horizon, marketVoice, market, signal, gap, description };
}

/** Was the council's side of the disagreement right? Null when it agreed with the market. */
export function councilRight(gap: number, outcome: number): boolean | null {
  return Math.abs(gap) < AGREE_GAP ? null : gap > 0 === (outcome === 1);
}

/** Pure scoring of recalled episodes against the current situation. */
export function weighEvidence(situation: Situation, texts: string[]): Evidence {
  const matches: Match[] = [];
  for (const text of texts) {
    const data = memoryData<EpisodeRecord>(text);
    const past = data?.situation;
    if (data?.kind !== 'episode' || data.v !== MEMORY_SCHEMA || !past) continue;
    if (data.eventId === situation.eventId || data.horizon !== situation.horizon) continue;
    if (past.councilRight === null || Math.sign(past.gap) !== Math.sign(situation.gap)) continue;
    matches.push({
      eventId: data.eventId,
      councilRight: past.councilRight,
      text: text.split(' | {')[0],
    });
    if (matches.length === MAX_MATCHES) break;
  }
  const hits = matches.filter((m) => m.councilRight).length;
  const enough = matches.length >= MIN_MATCHES && Math.abs(situation.gap) >= AGREE_GAP;
  const adjustment = enough
    ? clamp(RECALL_SENSITIVITY * (0.5 - hits / matches.length), ...ADJUST_RANGE)
    : 0;
  return { recalled: matches.length, hits, adjustment, matches };
}

export async function recallEvidence(situation: Situation): Promise<Evidence> {
  const texts = await recallMemories(NS.episodes, situation.description, RECALL_LIMIT);
  return weighEvidence(situation, texts);
}

export function saveSituation(s: Situation, evidence: Evidence | null, at = Date.now()) {
  run(
    `INSERT OR REPLACE INTO situations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.eventId,
    s.description,
    s.marketVoice,
    s.market,
    s.signal,
    s.gap,
    evidence?.recalled ?? null,
    evidence?.hits ?? null,
    evidence?.adjustment ?? 0,
    JSON.stringify(evidence?.matches ?? []),
    at,
  );
}

export type SituationRow = {
  event_id: string;
  description: string;
  market_voice: string;
  market: number;
  signal: number;
  gap: number;
  recalled: number | null;
  hits: number | null;
  adjustment: number;
  matches: string;
};

export const situationOf = (eventId: string) =>
  one<SituationRow>(`SELECT * FROM situations WHERE event_id = ?`, eventId);

/** Threshold change for an event from recalled episodes (0 without enough evidence). */
export const recallAdjustment = (eventId: string) => situationOf(eventId)?.adjustment ?? 0;
