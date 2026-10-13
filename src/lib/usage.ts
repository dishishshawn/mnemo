import { db, newId, type UsageEntry } from "./db";
import { configureGemini } from "./gemini";
import { breakdown } from "./pricing";

/** Persist every Gemini call's token usage and cost. Called once at startup. */
export function installUsageTracking(): void {
  configureGemini({
    onUsage: (r) => {
      const t = breakdown(r.usage);
      const entry: UsageEntry = { id: newId(), at: r.at, model: r.model, task: r.task, kitId: r.kitId, ...t, costUsd: r.costUsd };
      db.usage.add(entry).catch(() => {});
    },
  });
}

export function monthStart(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export interface UsageSummary {
  total: number;
  calls: number;
  byTask: { key: string; cost: number; calls: number }[];
  byModel: { key: string; cost: number; calls: number }[];
}

export function summarize(entries: UsageEntry[]): UsageSummary {
  const group = (key: (e: UsageEntry) => string) => {
    const m = new Map<string, { key: string; cost: number; calls: number }>();
    for (const e of entries) {
      const k = key(e);
      const g = m.get(k) ?? { key: k, cost: 0, calls: 0 };
      g.cost += e.costUsd;
      g.calls += 1;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost);
  };
  return {
    total: entries.reduce((n, e) => n + e.costUsd, 0),
    calls: entries.length,
    byTask: group((e) => taskLabel(e.task)),
    byModel: group((e) => e.model),
  };
}

const TASK_LABELS: Record<string, string> = {
  analyze: "Mapping concepts",
  flashcards: "Flashcards",
  "smart-questions": "Smart Study questions",
  "practice-test": "Practice tests",
  grade: "Grading answers",
  guide: "Study guides",
  summary: "Summaries",
  "podcast-script": "Podcast scripts",
  "podcast-audio": "Podcast audio",
  tutor: "Tutor chat",
  "key-check": "API key test",
  "ingest:document": "Reading PDFs",
  "ingest:image": "Reading images",
  "ingest:audio": "Transcribing audio",
  "ingest:video": "Transcribing video",
  "ingest:youtube": "YouTube videos",
  "ingest:web": "Web pages",
};

export function taskLabel(task: string): string {
  return TASK_LABELS[task] ?? task;
}

/** Straight-line projection of this month's spend to a full month. */
export function projectMonth(spentThisMonth: number, now = new Date()): number {
  const start = monthStart(now);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  // A quarter-day floor keeps the first hours of a month from projecting wildly.
  const elapsed = Math.max(0.25, (now.getTime() - start) / 86_400_000);
  const days = (end - start) / 86_400_000;
  return (spentThisMonth / elapsed) * days;
}
