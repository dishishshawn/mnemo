// Smart Study: the adaptive question loop. Pure functions over concepts and questions.
import type { Concept, Question } from "./db";
import { isDue, Rating, retrievability, review, type Grade } from "./srs";

export type Level = "new" | "weak" | "developing" | "strong";

export function levelOf(c: Pick<Concept, "attempts" | "mastery">): Level {
  if (c.attempts === 0) return "new";
  if (c.mastery < 0.4) return "weak";
  if (c.mastery < 0.75) return "developing";
  return "strong";
}

/** Difficulty to aim for: questions get harder as mastery grows. */
export function targetDifficulty(c: Pick<Concept, "attempts" | "mastery">): 1 | 2 | 3 {
  const level = levelOf(c);
  if (level === "new" || level === "weak") return 1;
  if (level === "developing") return 2;
  return 3;
}

/**
 * Picks the concepts to practise next, interleaving review with new material: about half the
 * targets are due-for-review or weak concepts (most-forgotten first), the rest are concepts not
 * seen yet (in material order), topped up from developing and then strong ones. Without the
 * quota, a few weak early concepts would crowd out the rest of the kit indefinitely.
 * `focus` (concept names) restricts the pool when the student steers the session.
 */
export function pickTargets(concepts: Concept[], k: number, now = new Date(), focus?: string[]): Concept[] {
  let pool = concepts;
  if (focus?.length) {
    const wanted = new Set(focus.map((f) => f.toLowerCase()));
    const filtered = concepts.filter((c) => wanted.has(c.name.toLowerCase()));
    if (filtered.length) pool = filtered;
  }
  const seen = pool.filter((c) => c.attempts > 0);
  const due = seen.filter((c) => isDue(c.srs, now)).sort((a, b) => retrievability(a.srs, now) - retrievability(b.srs, now));
  const weak = seen.filter((c) => !isDue(c.srs, now) && c.mastery < 0.4).sort((a, b) => a.mastery - b.mastery);
  const fresh = pool.filter((c) => c.attempts === 0).sort((a, b) => a.order - b.order);
  const developing = seen.filter((c) => !isDue(c.srs, now) && c.mastery >= 0.4 && c.mastery < 0.75).sort((a, b) => a.mastery - b.mastery);
  const strong = seen.filter((c) => !isDue(c.srs, now) && c.mastery >= 0.75).sort((a, b) => +new Date(a.srs.due) - +new Date(b.srs.due));

  const review = [...due, ...weak];
  const out: Concept[] = [];
  const take = (list: Concept[], n: number) => {
    for (const c of list) {
      if (out.length >= k || n <= 0) break;
      if (!out.includes(c)) {
        out.push(c);
        n--;
      }
    }
  };
  const reviewQuota = Math.ceil(k / 2);
  take(review, reviewQuota);
  take(fresh, k - out.length);
  for (const list of [review, developing, fresh, strong]) take(list, k - out.length);
  return out;
}

/** A missed question comes back after a day (retrieval practice), up to this many asks in total. */
export const REASK_AFTER_MS = 24 * 3_600_000;
export const MAX_ASKS = 3;

/** Never asked, or missed at least a day ago and not yet asked the maximum number of times. */
export function isAskable(q: Question, now = new Date()): boolean {
  if (q.origin !== "smart") return false;
  if (!q.askedAt) return true;
  return (q.lastScore ?? 1) < 0.8 && (q.asks ?? 1) < MAX_ASKS && now.getTime() - q.askedAt >= REASK_AFTER_MS;
}

/**
 * Chooses the next question for the target concepts, closest to the right difficulty. A missed
 * question that is due again is preferred slightly over a fresh one: that's the review.
 */
export function pickQuestion(questions: Question[], targets: Concept[], recentConcepts: string[] = [], now = new Date()): Question | undefined {
  const askable = questions.filter((q) => isAskable(q, now));
  const byName = new Map(targets.map((c, i) => [c.name.toLowerCase(), { c, i }]));
  let best: { q: Question; score: number } | undefined;
  for (const q of askable) {
    const t = byName.get(q.concept.toLowerCase());
    if (!t) continue;
    // Lower is better: target priority, difficulty mismatch, and not the same concept as the last few.
    const repeatPenalty = recentConcepts.slice(-3).includes(q.concept) ? 4 : 0;
    const reviewBonus = q.askedAt ? -1 : 0;
    const score = t.i + 2 * Math.abs(q.difficulty - targetDifficulty(t.c)) + repeatPenalty + reviewBonus;
    if (!best || score < best.score) best = { q, score };
  }
  return best?.q;
}

export function gradeFor(score: number, usedHint: boolean): Grade {
  if (score >= 0.8) return usedHint ? Rating.Hard : Rating.Good;
  if (score >= 0.4) return Rating.Hard;
  return Rating.Again;
}

/** Applies one answered question to the concept's mastery and review schedule. */
export function applyAnswer(c: Concept, score: number, usedHint: boolean, now = new Date()): Concept {
  const effective = usedHint ? score * 0.6 : score;
  // One right answer isn't mastery: the first attempt counts half, later ones blend in at 35%.
  const mastery = c.attempts === 0 ? effective * 0.5 : c.mastery * 0.65 + effective * 0.35;
  return {
    ...c,
    attempts: c.attempts + 1,
    correct: c.correct + (score >= 0.8 ? 1 : 0),
    mastery: Math.min(1, Math.max(0, mastery)),
    srs: review(c.srs, gradeFor(score, usedHint), now),
  };
}

/**
 * How many askable questions to keep ready before generating more. A batch takes 10 to 30 s to
 * write and multiple choice goes at about 10 s a question, so eight is enough runway that the
 * next batch lands before the pool runs dry.
 */
export const POOL_LOW_WATER = 8;
/** Of those, how many should be on the concepts being targeted right now. */
export const TARGET_LOW_WATER = 4;
/** Questions per Gemini call. Each call rereads the material, so bigger batches are cheaper per question. */
export const BATCH_SIZE = 16;

/** True when the pool (already filtered to the session's question types) is getting low. */
export function needsMore(questions: Question[], targets: Concept[], now = new Date()): boolean {
  const names = new Set(targets.map((t) => t.name.toLowerCase()));
  const ready = questions.filter((q) => isAskable(q, now));
  const onTarget = ready.filter((q) => names.has(q.concept.toLowerCase()));
  return ready.length < POOL_LOW_WATER || onTarget.length < TARGET_LOW_WATER;
}

/** Maps a concept name from the model onto the kit's concept list (models paraphrase names). */
export function matchConcept(name: string, concepts: Pick<Concept, "name">[]): string {
  if (!concepts.length) return name;
  const n = name.trim().toLowerCase();
  const exact = concepts.find((c) => c.name.toLowerCase() === n);
  if (exact) return exact.name;
  const contains = concepts.find((c) => n.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(n));
  if (contains) return contains.name;
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const target = words(name);
  let best = concepts[0].name;
  let bestScore = -1;
  for (const c of concepts) {
    const overlap = [...words(c.name)].filter((w) => target.has(w)).length;
    if (overlap > bestScore) {
      best = c.name;
      bestScore = overlap;
    }
  }
  return best;
}
