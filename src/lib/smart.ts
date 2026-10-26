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

// ---------- Difficulty ----------
//
// Each concept carries a difficulty level from 1 to 3 that moves with every first-try answer:
// up a little when it's right, down a full level when it isn't. The size of the step up sets the
// share of questions answered right that the level settles at (a weighted up/down staircase,
// Kaernbach 1991: it balances where target × up = (1 − target) × down). The setting picks that
// target, and on top of it the last few answers in the kit nudge everything down after a bad run.

export type Challenge = "gentle" | "balanced" | "push";

export const CHALLENGES: Record<Challenge, { label: string; target: number; shift: number; blurb: string }> = {
  gentle: { label: "Gentle", target: 0.9, shift: -0.5, blurb: "About 9 in 10 right. Mostly recall, with plainly wrong options." },
  balanced: { label: "Balanced", target: 0.8, shift: 0, blurb: "About 8 in 10 right. Recall first, then applying it." },
  push: { label: "Push me", target: 0.65, shift: 0.5, blurb: "About 2 in 3 right. More analysis, problems and close options." },
};

/** A miss drops the concept this many levels. */
const LEVEL_DOWN = 1;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Right on the first try, with no hint. Anything else counts as a miss for difficulty. */
export const firstTry = (score: number, usedHint: boolean) => score >= 0.8 && !usedHint;

/** A concept's level, 1 to 3. Concepts from before levels existed start from their mastery. */
export function levelValue(c: Pick<Concept, "attempts" | "mastery" | "level">): number {
  if (c.level !== undefined) return c.level;
  return c.attempts === 0 ? 1 : 1 + 1.5 * c.mastery;
}

/** Moves a level after one answer. */
export function stepLevel(level: number, score: number, usedHint: boolean, challenge: Challenge): number {
  const { target } = CHALLENGES[challenge];
  const up = (LEVEL_DOWN * (1 - target)) / target;
  return clamp(firstTry(score, usedHint) ? level + up : level - LEVEL_DOWN, 1, 3);
}

/**
 * A nudge from the last few answers in the kit: below the target, everything eases off (up to a
 * level); well above it, it climbs a little. Fewer than five answers say nothing yet.
 */
export function recentShift(recent: { score: number; usedHint: boolean }[], challenge: Challenge): number {
  if (recent.length < 5) return 0;
  const right = recent.filter((a) => firstTry(a.score, a.usedHint)).length / recent.length;
  return clamp((right - CHALLENGES[challenge].target) * 2.5, -1, 0.5);
}

/** How many recent answers `recentShift` looks at. */
export const RECENT_ANSWERS = 10;

/** Difficulty to aim for: the concept's level plus the setting's and the recent answers' shift. */
export function targetDifficulty(c: Pick<Concept, "attempts" | "mastery" | "level">, shift = 0): 1 | 2 | 3 {
  return clamp(Math.round(levelValue(c) + shift), 1, 3) as 1 | 2 | 3;
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

/** Never asked, or missed at least a day ago and not yet asked the maximum number of times. Never once reported wrong. */
export function isAskable(q: Question, now = new Date()): boolean {
  if (q.origin !== "smart" || q.flagged) return false;
  if (!q.askedAt) return true;
  return (q.lastScore ?? 1) < 0.8 && (q.asks ?? 1) < MAX_ASKS && now.getTime() - q.askedAt >= REASK_AFTER_MS;
}

/**
 * Chooses the next question for the target concepts, closest to the right difficulty. A missed
 * question that is due again is preferred slightly over a fresh one: that's the review.
 */
export function pickQuestion(questions: Question[], targets: Concept[], recentConcepts: string[] = [], now = new Date(), shift = 0): Question | undefined {
  const askable = questions.filter((q) => isAskable(q, now));
  const byName = new Map(targets.map((c, i) => [c.name.toLowerCase(), { c, i }]));
  let best: { q: Question; score: number } | undefined;
  for (const q of askable) {
    const t = byName.get(q.concept.toLowerCase());
    if (!t) continue;
    // Lower is better: target priority, difficulty mismatch, and not the same concept as the last few.
    const repeatPenalty = recentConcepts.slice(-3).includes(q.concept) ? 4 : 0;
    const reviewBonus = q.askedAt ? -1 : 0;
    const score = t.i + 3 * Math.abs(q.difficulty - targetDifficulty(t.c, shift)) + repeatPenalty + reviewBonus;
    if (!best || score < best.score) best = { q, score };
  }
  return best?.q;
}

export function gradeFor(score: number, usedHint: boolean): Grade {
  if (score >= 0.8) return usedHint ? Rating.Hard : Rating.Good;
  if (score >= 0.4) return Rating.Hard;
  return Rating.Again;
}

/**
 * Applies one answered question to the concept's mastery and review schedule. With a `challenge`
 * (questions, not Explain it back) the concept's difficulty level moves too.
 */
export function applyAnswer(c: Concept, score: number, usedHint: boolean, now = new Date(), challenge?: Challenge): Concept {
  const effective = usedHint ? score * 0.6 : score;
  // One right answer isn't mastery: the first attempt counts half, later ones blend in at 35%.
  const mastery = c.attempts === 0 ? effective * 0.5 : c.mastery * 0.65 + effective * 0.35;
  return {
    ...c,
    attempts: c.attempts + 1,
    correct: c.correct + (score >= 0.8 ? 1 : 0),
    mastery: Math.min(1, Math.max(0, mastery)),
    srs: review(c.srs, gradeFor(score, usedHint), now),
    level: challenge ? stepLevel(levelValue(c), score, usedHint, challenge) : c.level,
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

/**
 * Askable questions on the target concepts written at exactly the difficulty each is at now. Used
 * once at the start of a session, so a pool written for other levels (an older setting, or before
 * levels existed) gets a batch at the right ones.
 */
export function atLevel(questions: Question[], targets: Concept[], shift = 0, now = new Date()): number {
  const want = new Map(targets.map((t) => [t.name.toLowerCase(), targetDifficulty(t, shift)]));
  return questions.filter((q) => isAskable(q, now) && want.get(q.concept.toLowerCase()) === q.difficulty).length;
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
