// Exam planning: turns an exam date plus the FSRS state of every concept into a daily quota and
// an exam-day forecast. Pure functions, no API calls: everything here is computed on the device.
import { fsrs, Rating, State, type Card } from "ts-fsrs";
import type { Attempt, Concept } from "./db";
import { retrievability, reviveCard } from "./srs";

/** Predicted recall probability a concept should still have on exam day. */
export const TARGET_RETENTION = 0.9;
/** Fallback seconds per question until there is enough history to measure it. */
export const DEFAULT_SEC_PER_QUESTION = 45;
const DAY = 86_400_000;

/** Deterministic scheduler for forward simulation (the live one fuzzes intervals). */
const sim = fsrs({ enable_fuzz: false, request_retention: TARGET_RETENTION });

/** The exam starts at local midnight on its date: the night before is still study time. */
export function examStart(examDate: string): Date {
  const [y, m, d] = examDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Whole study days left before the exam, counting today. 0 on exam day or after. */
export function daysUntil(examDate: string, now = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((examStart(examDate).getTime() - start.getTime()) / DAY));
}

/**
 * How many successful reviews a card needs between now and the exam to arrive there above the
 * target retention. Simulates "Good" reviews at each due date, which is what FSRS schedules.
 * A concept never practised needs to be learnt first, then kept up.
 */
export function reviewsNeeded(card: Card, exam: Date, now = new Date()): number {
  let c = reviveCard(card);
  let n = 0;
  if (c.state === State.New) {
    c = sim.next(c, now, Rating.Good).card;
    n = 1;
  }
  // A card that is due before the exam is reviewed when due; one due after the exam but predicted
  // below target on exam day gets one more review now.
  for (let guard = 0; guard < 60; guard++) {
    const due = new Date(c.due).getTime();
    const at = Math.max(due, now.getTime());
    if (at >= exam.getTime()) {
      if (retrievability(c, exam) >= TARGET_RETENTION) break;
      c = sim.next(c, now, Rating.Good).card;
      n++;
      continue;
    }
    c = sim.next(c, new Date(at), Rating.Good).card;
    n++;
  }
  return n;
}

/**
 * Median seconds between consecutive answers within a sitting, from recent history. Gaps over
 * ten minutes are breaks, not thinking time.
 */
export function secondsPerQuestion(attempts: Attempt[]): number {
  const times = attempts
    .filter((a) => a.mode !== "explain")
    .map((a) => a.at)
    .sort((a, b) => a - b)
    .slice(-60);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] - times[i - 1]) / 1000;
    if (gap >= 3 && gap <= 600) gaps.push(gap);
  }
  if (gaps.length < 5) return DEFAULT_SEC_PER_QUESTION;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.min(180, Math.max(15, median));
}

/** Share of recent answers that were misses; misses mean a question comes back, so more work. */
export function missRate(attempts: Attempt[]): number {
  const recent = attempts.slice(-40);
  if (!recent.length) return 0.3;
  return recent.filter((a) => a.score < 0.8).length / recent.length;
}

export interface ConceptForecast {
  concept: Concept;
  /** Predicted recall on exam day with no more study, 0..1. */
  onExamDay: number;
  reviewsNeeded: number;
}

export interface StudyPlan {
  examDate: string;
  daysLeft: number;
  /** True on exam day and after. */
  over: boolean;
  /** Questions to answer per study day, from today, to be ready in time. */
  questionsPerDay: number;
  minutesPerDay: number;
  /** Questions answered today (local day). */
  doneToday: number;
  /** Remaining today; 0 when the quota is met. */
  leftToday: number;
  status: "ahead" | "on-track" | "behind" | "done";
  /** Mean predicted recall on exam day with no more study. */
  readiness: number;
  /** Share of concepts predicted above target on exam day with no more study. */
  readyShare: number;
  forecasts: ConceptForecast[];
  /** Mean predicted recall for each day from today to the exam (inclusive), with no more study. */
  curve: { day: string; retention: number }[];
  secPerQuestion: number;
}

export function buildPlan(examDate: string, concepts: Concept[], attempts: Attempt[], now = new Date()): StudyPlan {
  const exam = examStart(examDate);
  const daysLeft = daysUntil(examDate, now);
  const over = exam.getTime() <= now.getTime() || daysLeft === 0;
  const secPerQuestion = secondsPerQuestion(attempts);
  const misses = missRate(attempts);

  const forecasts: ConceptForecast[] = concepts
    .map((concept) => ({
      concept,
      onExamDay: retrievability(concept.srs, exam),
      reviewsNeeded: over ? 0 : reviewsNeeded(concept.srs, exam, now),
    }))
    .sort((a, b) => a.onExamDay - b.onExamDay);

  const readiness = forecasts.length ? forecasts.reduce((n, f) => n + f.onExamDay, 0) / forecasts.length : 0;
  const readyShare = forecasts.length ? forecasts.filter((f) => f.onExamDay >= TARGET_RETENTION).length / forecasts.length : 0;

  // Each review is about one question; misses bring a question back, which is extra work.
  const reviews = forecasts.reduce((n, f) => n + f.reviewsNeeded, 0);
  const totalQuestions = Math.ceil(reviews * (1 + misses));
  const questionsPerDay = over ? 0 : Math.ceil(totalQuestions / Math.max(1, daysLeft));
  const minutesPerDay = Math.ceil((questionsPerDay * secPerQuestion) / 60);

  const today = todayKey(now);
  const doneToday = attempts.filter((a) => todayKey(new Date(a.at)) === today).length;
  const leftToday = Math.max(0, questionsPerDay - doneToday);

  let status: StudyPlan["status"];
  if (over || questionsPerDay === 0) status = "done";
  else if (doneToday >= questionsPerDay) status = "ahead";
  else if (now.getHours() >= 20 && doneToday < questionsPerDay / 2) status = "behind";
  else status = "on-track";

  const curve: StudyPlan["curve"] = [];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i <= Math.min(daysLeft, 120); i++) {
    const at = new Date(start.getTime() + i * DAY + (i === 0 ? now.getTime() - start.getTime() : 0));
    const r = concepts.length ? concepts.reduce((n, c) => n + retrievability(c.srs, at), 0) / concepts.length : 0;
    curve.push({ day: todayKey(at), retention: r });
  }

  return {
    examDate,
    daysLeft,
    over,
    questionsPerDay,
    minutesPerDay,
    doneToday,
    leftToday,
    status,
    readiness,
    readyShare,
    forecasts,
    curve,
    secPerQuestion,
  };
}

export function formatDaysLeft(daysLeft: number, over: boolean): string {
  if (over) return "Exam day";
  if (daysLeft === 1) return "Exam tomorrow";
  return `Exam in ${daysLeft} days`;
}
