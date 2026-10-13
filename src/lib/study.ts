import { db, newId, type Concept, type Flashcard, type Kit, type Output, type Question, type Source } from "./db";
import { GeminiError, generateJson, generateText, streamText, synthesizeDialogue } from "./gemini";
import { ingestFile, ingestWebPage, ingestYouTube, stripFence } from "./ingest";
import { kindOf } from "./extract";
import {
  analyzeSchema,
  analyzeTask,
  flashcardSchema,
  flashcardTask,
  GRADER_SYSTEM,
  gradeSchema,
  gradeTask,
  guideTask,
  podcastSchema,
  podcastTask,
  questionSchema,
  questionTask,
  summaryTask,
  SYSTEM,
  tutorSystem,
  withMaterial,
  type AnalyzeResult,
  type FlashcardResult,
  type GradeResult,
  type PodcastScript,
  type QuestionResult,
  type QuestionTarget,
} from "./prompts";
import { getSettings } from "./settings";
import { matchConcept } from "./smart";
import { newCard } from "./srs";
import { pcmSeconds, pcmToWav } from "./wav";
import type { Content } from "@google/genai";

/** ~400k tokens. Beyond this a kit is really several kits; we truncate and say so. */
export const MAX_MATERIAL_CHARS = 1_600_000;

export async function kitOrThrow(kitId: string): Promise<Kit> {
  const kit = await db.kits.get(kitId);
  if (!kit) throw new Error("Study kit not found.");
  return kit;
}

export async function materialFor(kitId: string): Promise<string> {
  const sources = (await db.sources.where("kitId").equals(kitId).toArray())
    .filter((s) => s.status === "ready" && s.text.trim())
    .sort((a, b) => a.createdAt - b.createdAt);
  if (!sources.length) throw new Error("This kit has no readable material yet.");
  const text = sources.map((s) => `# Source: ${s.name}\n\n${s.text}`).join("\n\n---\n\n");
  return text.length > MAX_MATERIAL_CHARS
    ? `${text.slice(0, MAX_MATERIAL_CHARS)}\n\n[Material truncated: the kit is too large to use in full.]`
    : text;
}

const norm = (s: string) => s.trim().toLowerCase();

// ---------- Creating kits and adding material ----------

export type NewSource =
  | { type: "file"; file: File; deepRead?: boolean }
  | { type: "youtube"; url: string }
  | { type: "web"; url: string }
  | { type: "text"; name: string; text: string };

export async function createKit(opts: { title?: string; language: string; folderId?: string }): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db.kits.add({
    id,
    title: opts.title?.trim() || "New study kit",
    description: "",
    emoji: "📚",
    language: opts.language,
    folderId: opts.folderId,
    status: "processing",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Ingests each source in turn, then (re)analyses the kit. Errors are recorded per source. */
export async function addSources(
  kitId: string,
  items: NewSource[],
  onStatus?: (sourceName: string, status: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  await db.kits.update(kitId, { status: "processing", error: undefined });
  const rows: { item: NewSource; source: Source }[] = items.map((item) => {
    const base = { id: newId(), kitId, text: "", status: "pending" as const, createdAt: Date.now() };
    switch (item.type) {
      case "file":
        return {
          item,
          source: { ...base, kind: kindOf(item.file), name: item.file.name, mime: item.file.type, size: item.file.size },
        };
      case "youtube":
        return { item, source: { ...base, kind: "youtube", name: item.url, url: item.url } };
      case "web":
        return { item, source: { ...base, kind: "web", name: item.url, url: item.url } };
      case "text":
        return { item, source: { ...base, kind: "text", name: item.name || "Pasted notes", text: item.text } };
    }
  });
  await db.sources.bulkAdd(rows.map((r) => r.source));

  for (const { item, source } of rows) {
    if (signal?.aborted) break;
    const report = (status: string) => onStatus?.(source.name, status);
    await db.sources.update(source.id, { status: "processing" });
    try {
      const opts = { kitId, signal, onStatus: report };
      const result =
        item.type === "file"
          ? await ingestFile(item.file, source.kind, { ...opts, deepRead: item.deepRead })
          : item.type === "youtube"
            ? await ingestYouTube(item.url, opts)
            : item.type === "web"
              ? await ingestWebPage(item.url, opts)
              : { text: item.text, via: "pasted" };
      if (!result.text.trim()) throw new Error("No text could be extracted.");
      await db.sources.update(source.id, { text: result.text, via: result.via, status: "ready" });
    } catch (err) {
      await db.sources.update(source.id, { status: "error", error: (err as Error).message });
    }
  }

  if (signal?.aborted) {
    await db.sources
      .where("id")
      .anyOf(rows.map((r) => r.source.id))
      .filter((s) => s.status === "pending" || s.status === "processing")
      .modify({ status: "error", error: "Cancelled before it was read." });
  }
  // An existing kit stays usable if adding to it fails; the error surfaces on the job instead.
  const established = (await db.concepts.where("kitId").equals(kitId).count()) > 0;
  const ready = await db.sources.where("kitId").equals(kitId).filter((s) => s.status === "ready").count();
  if (!ready) {
    await db.kits.update(kitId, { status: "error", error: "None of the material could be read." });
    return;
  }
  try {
    onStatus?.("kit", "Mapping the key concepts");
    await analyzeKit(kitId, signal);
    await db.kits.update(kitId, { status: "ready", error: undefined, updatedAt: Date.now() });
  } catch (err) {
    if (established) {
      await db.kits.update(kitId, { status: "ready" });
      throw err;
    }
    await db.kits.update(kitId, { status: "error", error: (err as Error).message });
  }
}

export async function analyzeKit(kitId: string, signal?: AbortSignal): Promise<void> {
  const kit = await kitOrThrow(kitId);
  const material = await materialFor(kitId);
  const res = await generateJson<AnalyzeResult>({
    role: "smart",
    task: "analyze",
    kitId,
    signal,
    system: SYSTEM,
    contents: withMaterial(material, analyzeTask(kit.language)),
    schema: analyzeSchema,
  });
  const existing = await db.concepts.where("kitId").equals(kitId).toArray();
  const byName = new Map(existing.map((c) => [norm(c.name), c]));
  const concepts: Concept[] = res.concepts.map((c, order) => {
    const prev = byName.get(norm(c.name));
    return prev
      ? { ...prev, summary: c.summary, order }
      : { id: newId(), kitId, name: c.name, summary: c.summary, order, srs: newCard(), attempts: 0, correct: 0, mastery: 0 };
  });
  const keep = new Set(concepts.map((c) => c.id));
  await db.transaction("rw", db.concepts, db.kits, async () => {
    if (!(await db.kits.get(kitId))) return; // deleted while Gemini was working
    await db.concepts.bulkDelete(existing.filter((c) => !keep.has(c.id)).map((c) => c.id));
    await db.concepts.bulkPut(concepts);
    const untitled = kit.title === "New study kit";
    await db.kits.update(kitId, {
      title: untitled ? res.title : kit.title,
      description: res.description,
      emoji: res.emoji || kit.emoji,
      updatedAt: Date.now(),
    });
  });
}

// ---------- Flashcards ----------

export async function generateFlashcards(kitId: string, opts: { count?: number; focus?: string; signal?: AbortSignal } = {}) {
  const kit = await kitOrThrow(kitId);
  const material = await materialFor(kitId);
  const concepts = await db.concepts.where("kitId").equals(kitId).sortBy("order");
  const existing = await db.flashcards.where("kitId").equals(kitId).toArray();
  const res = await generateJson<FlashcardResult>({
    role: "smart",
    task: "flashcards",
    kitId,
    signal: opts.signal,
    system: SYSTEM,
    contents: withMaterial(
      material,
      flashcardTask({
        language: kit.language,
        count: opts.count ?? 24,
        concepts: concepts.map((c) => c.name),
        existingFronts: existing.map((c) => c.front),
        focus: opts.focus,
      }),
    ),
    schema: flashcardSchema,
  });
  const seen = new Set(existing.map((c) => norm(c.front)));
  const cards: Flashcard[] = res.cards
    .filter((c) => c.front.trim() && c.back.trim() && !seen.has(norm(c.front)))
    .map((c) => ({
      id: newId(),
      kitId,
      front: c.front.trim(),
      back: c.back.trim(),
      kind: c.kind === "term" ? "term" : "qa",
      concept: c.concept,
      srs: newCard(),
      createdAt: Date.now(),
    }));
  await kitOrThrow(kitId); // deleted while Gemini was working?
  await db.flashcards.bulkAdd(cards);
  return cards;
}

// ---------- Questions ----------

function toQuestions(kitId: string, res: QuestionResult, origin: Question["origin"], concepts: Concept[]): Question[] {
  return res.questions
    .map((q): Question | null => {
      let options = q.options ?? [];
      let answerIndex = q.answerIndex;
      if (q.type === "tf") {
        options = ["True", "False"];
        // Accept either index or an answer string for TF.
        if (answerIndex !== 0 && answerIndex !== 1) answerIndex = /^t/i.test(q.answer) ? 0 : 1;
      }
      if (q.type === "mcq" && (options.length < 2 || answerIndex < 0 || answerIndex >= options.length)) return null;
      if (q.type === "short") {
        options = [];
        answerIndex = -1;
      }
      return {
        id: newId(),
        kitId,
        concept: matchConcept(q.concept, concepts),
        type: q.type,
        difficulty: Math.min(3, Math.max(1, Math.round(q.difficulty))) as 1 | 2 | 3,
        prompt: q.prompt,
        options,
        answerIndex,
        answer: q.answer,
        explanation: q.explanation,
        hint: q.hint,
        origin,
        createdAt: Date.now(),
      };
    })
    .filter((q): q is Question => q !== null);
}

export async function generateSmartQuestions(
  kitId: string,
  targets: QuestionTarget[],
  opts: { count?: number; steer?: string; types?: ("mcq" | "tf" | "short")[]; signal?: AbortSignal } = {},
): Promise<Question[]> {
  const kit = await kitOrThrow(kitId);
  const material = await materialFor(kitId);
  const concepts = await db.concepts.where("kitId").equals(kitId).toArray();
  const previous = await db.questions.where("kitId").equals(kitId).toArray();
  const res = await generateJson<QuestionResult>({
    role: "smart",
    task: "smart-questions",
    kitId,
    signal: opts.signal,
    system: SYSTEM,
    contents: withMaterial(
      material,
      questionTask({
        language: kit.language,
        count: opts.count ?? 8,
        targets,
        types: opts.types ?? ["mcq", "short", "tf"],
        avoid: previous.map((q) => q.prompt),
        steer: opts.steer,
        purpose: "smart",
      }),
    ),
    schema: questionSchema,
  });
  const questions = toQuestions(kitId, res, "smart", concepts);
  await kitOrThrow(kitId);
  await db.questions.bulkAdd(questions);
  return questions;
}

export async function generateTestQuestions(
  kitId: string,
  opts: { count: number; types: ("mcq" | "tf" | "short")[]; focus?: string; signal?: AbortSignal },
): Promise<Question[]> {
  const kit = await kitOrThrow(kitId);
  const material = await materialFor(kitId);
  const concepts = await db.concepts.where("kitId").equals(kitId).sortBy("order");
  const previous = await db.questions.where("[kitId+origin]").equals([kitId, "test"]).toArray();
  const res = await generateJson<QuestionResult>({
    role: "smart",
    task: "practice-test",
    kitId,
    signal: opts.signal,
    system: SYSTEM,
    contents: withMaterial(
      material,
      questionTask({
        language: kit.language,
        count: opts.count,
        targets: concepts.map((c) => ({ name: c.name, mastery: c.mastery, attempts: c.attempts })),
        types: opts.types,
        avoid: previous.map((q) => q.prompt),
        steer: opts.focus,
        purpose: "test",
      }),
    ),
    schema: questionSchema,
  });
  const questions = toQuestions(kitId, res, "test", concepts);
  await kitOrThrow(kitId);
  await db.questions.bulkAdd(questions);
  return questions;
}

export interface ShortAnswerItem {
  id: string;
  question: string;
  modelAnswer: string;
  studentAnswer: string;
  /** false: Socratic nudge without the answer (first try in Smart Study). */
  reveal: boolean;
}

export async function gradeShortAnswers(kitId: string, items: ShortAnswerItem[], signal?: AbortSignal) {
  if (!items.length) return new Map<string, GradeResult["results"][number]>();
  const kit = await kitOrThrow(kitId);
  const res = await generateJson<GradeResult>({
    role: "fast",
    task: "grade",
    kitId,
    signal,
    system: GRADER_SYSTEM,
    contents: gradeTask(kit.language, items),
    schema: gradeSchema,
  });
  const out = new Map<string, GradeResult["results"][number]>();
  const byId = new Map(res.results.map((r) => [r.id, r]));
  items.forEach((it, i) => {
    // Models occasionally rename ids; fall back to position when the counts line up.
    const r = byId.get(it.id) ?? (res.results.length === items.length ? res.results[i] : undefined);
    if (r) out.set(it.id, { ...r, id: it.id, score: Math.min(1, Math.max(0, r.score)) });
  });
  // A blank answer is wrong no matter what the grader says.
  for (const it of items)
    if (!it.studentAnswer.trim())
      out.set(it.id, { id: it.id, verdict: "incorrect", score: 0, feedback: out.get(it.id)?.feedback ?? "No answer given." });
  if (items.some((it) => !out.has(it.id))) throw new GeminiError("The grader skipped an answer. Try again.", "bad-json");
  return out;
}

// ---------- Guides, summaries ----------

export async function generateDocument(kitId: string, type: "guide" | "summary", signal?: AbortSignal): Promise<Output> {
  const kit = await kitOrThrow(kitId);
  const material = await materialFor(kitId);
  const concepts = await db.concepts.where("kitId").equals(kitId).sortBy("order");
  const text = await generateText({
    role: "smart",
    task: type,
    kitId,
    signal,
    system: SYSTEM,
    contents: withMaterial(
      material,
      type === "guide" ? guideTask(kit.language, concepts.map((c) => c.name)) : summaryTask(kit.language),
    ),
  });
  const output: Output = {
    id: newId(),
    kitId,
    type,
    title: type === "guide" ? `${kit.title}: Study guide` : `${kit.title}: Summary`,
    content: stripFence(text),
    createdAt: Date.now(),
  };
  await kitOrThrow(kitId);
  await db.outputs.add(output);
  return output;
}

// ---------- Podcast ----------

export const HOSTS: [string, string] = ["Alex", "Sam"];

/** Splits a script into TTS-sized chunks (~2 minutes of speech each), on turn boundaries. */
export function chunkScript(lines: PodcastScript["lines"], maxChars = 1800): PodcastScript["lines"][] {
  const chunks: PodcastScript["lines"][] = [];
  let current: PodcastScript["lines"] = [];
  let size = 0;
  for (const line of lines) {
    if (current.length && size + line.text.length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function generatePodcast(
  kitId: string,
  opts: { focus?: string; signal?: AbortSignal; onProgress?: (done: number, total: number, stage: string) => void } = {},
): Promise<Output> {
  const kit = await kitOrThrow(kitId);
  const settings = getSettings();
  const material = await materialFor(kitId);
  opts.onProgress?.(0, 1, "Writing the script");
  const script = await generateJson<PodcastScript>({
    role: "smart",
    task: "podcast-script",
    kitId,
    signal: opts.signal,
    system: SYSTEM,
    contents: withMaterial(
      material,
      podcastTask({ language: kit.language, minutes: settings.podcastMinutes, hostA: HOSTS[0], hostB: HOSTS[1], focus: opts.focus }),
    ),
    schema: podcastSchema,
  });
  const chunks = chunkScript(script.lines.filter((l) => l.text.trim()));
  const pcm: Uint8Array[] = new Array(chunks.length);
  let sampleRate = 24000;
  let done = 0;
  opts.onProgress?.(0, chunks.length, "Recording audio");
  // Two at a time: faster than serial, gentle enough for free-tier rate limits.
  const queue = chunks.map((_, i) => i);
  const worker = async () => {
    for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
      const text = chunks[i].map((l) => `${l.speaker === "A" ? HOSTS[0] : HOSTS[1]}: ${l.text}`).join("\n");
      const res = await synthesizeDialogue({
        script: `Read this study podcast conversation between ${HOSTS[0]} and ${HOSTS[1]} aloud, warm and lively, at a natural pace:\n\n${text}`,
        speakers: HOSTS,
        voices: settings.podcastVoices,
        task: "podcast-audio",
        kitId,
        signal: opts.signal,
      });
      pcm[i] = res.pcm;
      sampleRate = res.sampleRate;
      opts.onProgress?.(++done, chunks.length, "Recording audio");
    }
  };
  await Promise.all([worker(), worker()]);
  const wav = pcmToWav(pcm, sampleRate);
  const output: Output = {
    id: newId(),
    kitId,
    type: "podcast",
    title: script.title,
    content: JSON.stringify(script),
    audio: new Blob([wav as BlobPart], { type: "audio/wav" }),
    durationSec: Math.round(pcmSeconds(wav.length - 44, sampleRate)),
    createdAt: Date.now(),
  };
  await kitOrThrow(kitId);
  await db.outputs.add(output);
  return output;
}

// ---------- Tutor ----------

export async function tutorReply(
  kitId: string,
  history: { role: "user" | "model"; text: string }[],
  socratic: boolean,
  onText: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const kit = await kitOrThrow(kitId);
  const material = await materialFor(kitId);
  // Material stays the first turn so every message in a conversation hits the implicit cache.
  const contents: Content[] = [
    { role: "user", parts: [{ text: `<material>\n${material}\n</material>` }] },
    { role: "model", parts: [{ text: "I've read your material. What would you like to work on?" }] },
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
  ];
  return streamText(
    { role: "smart", task: "tutor", kitId, signal, system: tutorSystem(socratic, kit.language), contents },
    onText,
  );
}
