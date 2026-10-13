import Dexie, { type EntityTable } from "dexie";
import type { Card as FsrsCard } from "ts-fsrs";

export type SourceKind = "pdf" | "docx" | "pptx" | "image" | "audio" | "video" | "youtube" | "web" | "text";
export type JobStatus = "pending" | "processing" | "ready" | "error";

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface Kit {
  id: string;
  title: string;
  description: string;
  emoji: string;
  folderId?: string;
  /** "auto" means: write in the material's own language. */
  language: string;
  status: JobStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
  lastStudiedAt?: number;
}

export interface Source {
  id: string;
  kitId: string;
  kind: SourceKind;
  name: string;
  mime?: string;
  size?: number;
  url?: string;
  /** Extracted or transcribed content, as Markdown. Everything downstream reads this. */
  text: string;
  status: JobStatus;
  error?: string;
  /** How the text was obtained, shown to the user ("local", or the model id). */
  via?: string;
  createdAt: number;
}

export interface Concept {
  id: string;
  kitId: string;
  name: string;
  summary: string;
  order: number;
  srs: FsrsCard;
  attempts: number;
  correct: number;
  /** 0..1, an exponential moving average of recent scores. */
  mastery: number;
}

export interface Flashcard {
  id: string;
  kitId: string;
  front: string;
  back: string;
  kind: "term" | "qa";
  concept?: string;
  srs: FsrsCard;
  createdAt: number;
}

export type QuestionType = "mcq" | "tf" | "short";

export interface Question {
  id: string;
  kitId: string;
  concept: string;
  type: QuestionType;
  difficulty: 1 | 2 | 3;
  prompt: string;
  options: string[];
  answerIndex: number;
  answer: string;
  explanation: string;
  hint: string;
  origin: "smart" | "test";
  createdAt: number;
  /** Set once the question has been asked in Smart Study. */
  askedAt?: number;
}

export interface Attempt {
  id: string;
  kitId: string;
  questionId: string;
  concept: string;
  mode: "smart" | "test";
  response: string;
  /** 0..1 */
  score: number;
  usedHint: boolean;
  feedback?: string;
  at: number;
}

export interface TestRun {
  id: string;
  kitId: string;
  questionIds: string[];
  answers: Record<string, string>;
  results?: Record<string, { score: number; feedback: string }>;
  score?: number;
  timeLimitMin?: number;
  startedAt: number;
  finishedAt?: number;
}

export type OutputType = "guide" | "summary" | "podcast";

export interface Output {
  id: string;
  kitId: string;
  type: OutputType;
  title: string;
  /** Markdown for guide/summary, JSON-encoded script for podcast. */
  content: string;
  /**
   * WAV bytes. Stored as an ArrayBuffer: Safari's IndexedDB can refuse Blobs ("Error preparing
   * Blob/File data to be stored in object store"). Older rows may still hold a Blob.
   */
  audio?: ArrayBuffer | Blob;
  durationSec?: number;
  createdAt: number;
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  at: number;
}

export interface Chat {
  id: string;
  kitId: string;
  socratic: boolean;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface UsageEntry {
  id: string;
  at: number;
  model: string;
  task: string;
  kitId?: string;
  input: number;
  audioInput: number;
  cached: number;
  output: number;
  audioOutput: number;
  thoughts: number;
  costUsd: number;
}

/** Records a deletion so it can propagate to other devices through sync. */
export interface Tombstone {
  id: string; // "<table>:<key>"
  table: string;
  key: string;
  at: number;
}

export interface GameScore {
  id: string;
  kitId: string;
  game: "match" | "builder" | "stacker";
  score: number;
  at: number;
}

export const db = new Dexie("mnemo") as Dexie & {
  folders: EntityTable<Folder, "id">;
  kits: EntityTable<Kit, "id">;
  sources: EntityTable<Source, "id">;
  concepts: EntityTable<Concept, "id">;
  flashcards: EntityTable<Flashcard, "id">;
  questions: EntityTable<Question, "id">;
  attempts: EntityTable<Attempt, "id">;
  tests: EntityTable<TestRun, "id">;
  outputs: EntityTable<Output, "id">;
  chats: EntityTable<Chat, "id">;
  usage: EntityTable<UsageEntry, "id">;
  scores: EntityTable<GameScore, "id">;
  tombstones: EntityTable<Tombstone, "id">;
};

db.version(1).stores({
  folders: "id, createdAt",
  kits: "id, folderId, updatedAt",
  sources: "id, kitId",
  concepts: "id, kitId",
  flashcards: "id, kitId",
  questions: "id, kitId, [kitId+origin]",
  attempts: "id, kitId, questionId, at",
  tests: "id, kitId, startedAt",
  outputs: "id, kitId, [kitId+type]",
  chats: "id, kitId",
  usage: "id, at, kitId",
  scores: "id, kitId, [kitId+game]",
});

// v2: sync. Synced rows also carry `_ts` (last local edit, ms), set by hooks in sync.ts.
db.version(2).stores({
  tombstones: "id, at",
});

export const newId = () => crypto.randomUUID();

/** Podcast audio as a playable/downloadable Blob, whichever form it was stored in. */
export function audioBlob(audio: ArrayBuffer | Blob): Blob {
  return audio instanceof Blob ? audio : new Blob([audio], { type: "audio/wav" });
}

export const KIT_TABLES = [
  "sources",
  "concepts",
  "flashcards",
  "questions",
  "attempts",
  "tests",
  "outputs",
  "chats",
  "scores",
] as const;

/** Tables that sync across devices (everything except tombstones themselves). */
export const SYNC_TABLES = ["folders", "kits", ...KIT_TABLES, "usage"] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export async function deleteKit(kitId: string): Promise<void> {
  await db.transaction("rw", [db.kits, ...KIT_TABLES.map((t) => db[t])], async () => {
    for (const t of KIT_TABLES) await db[t].where("kitId").equals(kitId).delete();
    await db.kits.delete(kitId);
  });
}
