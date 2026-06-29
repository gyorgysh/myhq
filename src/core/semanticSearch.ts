/**
 * Generic semantic + keyword search over an arbitrary set of text items.
 *
 * This is the same hybrid approach the memory store uses (cosine similarity
 * blended with normalized keyword overlap), generalized so the kanban board and
 * skill library can rank cards/skills by meaning, not just substring match.
 *
 * Unlike memory, task/skill vectors are NOT persisted — there are few enough of
 * each that embedding the candidate set on demand per search is cheap and keeps
 * the stores untouched. Everything is best-effort: when embeddings are disabled
 * or the endpoint is unreachable, it degrades to pure keyword ranking so search
 * always returns something useful.
 */

import { cosineSimilarity, embedBatch, embedText, embeddingsEnabled } from "./embeddings.js";

/** One searchable item: a stable id and the text to match against. */
export interface SearchItem {
  id: string;
  /** Concatenated searchable text (e.g. title + notes, or name + prompt). */
  text: string;
}

export interface SearchHit<T> {
  item: T;
  score: number;
}

/** Lowercase word tokens of length >= 3, matching memory.ts's tokenizer. */
function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3);
}

/** Count how many of `terms` appear in `text`. */
function keywordHits(text: string, terms: Set<string>): number {
  const hay = new Set(tokenize(text));
  let hits = 0;
  for (const t of terms) if (hay.has(t)) hits++;
  return hits;
}

/** Pure keyword ranking: hits descending, ties broken by shorter text. */
function keywordRank<T extends SearchItem>(items: T[], query: string, limit: number): SearchHit<T>[] {
  const terms = new Set(tokenize(query));
  if (terms.size === 0) return [];
  const scored: SearchHit<T>[] = [];
  for (const it of items) {
    const hits = keywordHits(it.text, terms);
    if (hits > 0) scored.push({ item: it, score: hits });
  }
  scored.sort((a, b) => b.score - a.score || a.item.text.length - b.item.text.length);
  return scored.slice(0, limit);
}

/**
 * Rank `items` by relevance to `query`. When embeddings are on and reachable,
 * blends cosine similarity (0.7) with normalized keyword overlap (0.3); falls
 * back to keyword-only otherwise. Returns the top `limit` hits with scores.
 */
export async function semanticSearch<T extends SearchItem>(
  items: T[],
  query: string,
  limit = 10,
): Promise<SearchHit<T>[]> {
  if (items.length === 0 || !query.trim()) return [];

  // Fast path: no embedding backend, just keyword rank.
  if (!embeddingsEnabled()) return keywordRank(items, query, limit);

  const queryVec = await embedText(query);
  if (!queryVec) return keywordRank(items, query, limit);

  const vectors = await embedBatch(items.map((it) => it.text));
  if (!vectors || vectors.length !== items.length) return keywordRank(items, query, limit);

  const terms = new Set(tokenize(query));
  const maxHits = Math.max(1, terms.size);
  const scored: SearchHit<T>[] = [];
  for (let i = 0; i < items.length; i++) {
    const sim = vectors[i].length ? cosineSimilarity(queryVec, vectors[i]) : 0;
    const kw = terms.size ? keywordHits(items[i].text, terms) / maxHits : 0;
    const score = sim * 0.7 + kw * 0.3;
    if (sim > 0 || kw > 0) scored.push({ item: items[i], score });
  }
  // Nothing matched on either signal — surface keyword hits as a last resort.
  if (scored.length === 0) return keywordRank(items, query, limit);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
