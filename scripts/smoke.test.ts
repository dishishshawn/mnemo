// End-to-end check against the real Gemini API, and the source of the numbers in docs/COSTS.md.
// Runs every feature once on a real lecture-sized text and prints tokens and cost per call.
//
//   GEMINI_API_KEY=... just smoke
//
// Costs roughly $0.25 at paid-tier prices (nothing on a free-tier key).
import "fake-indexeddb/auto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { audioBlob, db } from "../src/lib/db";
import { configureGemini, type UsageRecord } from "../src/lib/gemini";
import { breakdown, costOf } from "../src/lib/pricing";
import { DEFAULT_SETTINGS, type Settings } from "../src/lib/settings";
import { pickTargets } from "../src/lib/smart";
import {
  addSources,
  createKit,
  generateDocument,
  generateFlashcards,
  generatePodcast,
  generateSmartQuestions,
  generateTestQuestions,
  gradeShortAnswers,
  tutorReply,
} from "../src/lib/study";
import { ingestYouTube } from "../src/lib/ingest";
import { synthesizeDialogue } from "../src/lib/gemini";

const key = process.env.GEMINI_API_KEY ?? "";
const settings: Settings = { ...DEFAULT_SETTINGS, apiKey: key, podcastMinutes: 3 };
const calls: UsageRecord[] = [];

configureGemini({
  getSettings: () => settings,
  onUsage: (r) => {
    calls.push(r);
    const t = breakdown(r.usage);
    console.log(
      `${r.task.padEnd(18)} ${r.model.padEnd(26)} in=${String(t.input + t.audioInput).padStart(7)} cached=${String(t.cached).padStart(6)} out=${String(t.output + t.audioOutput).padStart(6)} think=${String(t.thoughts).padStart(5)}  $${r.costUsd.toFixed(5)}`,
    );
  },
});

const CACHE = "scratch/smoke-material.md";

/** A real ~10k-token lecture-length text: Wikipedia's "Cellular respiration" (CC BY-SA). */
async function material(): Promise<string> {
  if (existsSync(CACHE)) return readFileSync(CACHE, "utf8");
  const url = "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=Cellular_respiration&format=json&formatversion=2";
  const res = await fetch(url, { headers: { "User-Agent": "mnemo-smoke-test/0.1" } });
  const json = (await res.json()) as { query: { pages: { extract: string }[] } };
  const text = json.query.pages[0].extract.split("\n== See also ==")[0];
  mkdirSync("scratch", { recursive: true });
  writeFileSync(CACHE, text);
  return text;
}

describe.skipIf(!key)("Gemini smoke test", () => {
  it("speaks a two-host dialogue (TTS only)", { timeout: 120_000 }, async () => {
    const res = await synthesizeDialogue({
      turns: [
        { speaker: "Alex", text: "Welcome back! Today we're talking about how cells make ATP.", style: "warm, enthusiastic" },
        { speaker: "Sam", text: "Wait, so glucose doesn't just turn straight into energy?", style: "curious" },
      ],
      speakers: ["Alex", "Sam"],
      voices: ["Puck", "Kore"],
      task: "podcast-audio",
    });
    const seconds = res.pcm.length / 2 / res.sampleRate;
    console.log(`  tts: ${seconds.toFixed(1)}s at ${res.sampleRate} Hz`);
    expect(seconds).toBeGreaterThan(2);
  });

  it("runs every feature end to end", { timeout: 15 * 60_000 }, async () => {
    const text = await material();
    console.log(`Material: ${text.length.toLocaleString()} chars (~${Math.round(text.length / 4).toLocaleString()} tokens)\n`);

    const kitId = await createKit({ language: "auto" });
    await addSources(kitId, [{ type: "text", name: "Cellular respiration", text }], (n, s) => console.log(`  [${n}] ${s}`));
    const kit = await db.kits.get(kitId);
    expect(kit?.status, kit?.error).toBe("ready");
    const concepts = await db.concepts.where("kitId").equals(kitId).sortBy("order");
    console.log(`  title="${kit?.title}" ${kit?.emoji} concepts=${concepts.length}: ${concepts.map((c) => c.name).join(" | ")}\n`);
    expect(concepts.length).toBeGreaterThanOrEqual(5);

    const cards = await generateFlashcards(kitId, { count: 24 });
    console.log(`  flashcards=${cards.length}; e.g. "${cards[0]?.front}" -> "${cards[0]?.back}"`);
    expect(cards.length).toBeGreaterThanOrEqual(15);

    const targets = pickTargets(concepts, 4);
    const smart = await generateSmartQuestions(kitId, targets.map((t) => ({ name: t.name, mastery: 0, attempts: 0 })), { count: 8 });
    console.log(`  smart questions=${smart.length}; types=${smart.map((q) => q.type).join(",")}`);
    expect(smart.length).toBeGreaterThanOrEqual(6);
    const unmatched = smart.filter((q) => !concepts.some((c) => c.name === q.concept));
    expect(unmatched, "question concepts must map onto kit concepts").toHaveLength(0);

    const short = smart.find((q) => q.type === "short") ?? smart[0];
    const graded = await gradeShortAnswers(kitId, [
      { id: "good", question: short.prompt, modelAnswer: short.answer, studentAnswer: short.answer, reveal: false },
      { id: "bad", question: short.prompt, modelAnswer: short.answer, studentAnswer: "I think it has something to do with photosynthesis.", reveal: false },
    ]);
    console.log(`  grading: good=${graded.get("good")?.verdict} (${graded.get("good")?.score}) bad=${graded.get("bad")?.verdict}: "${graded.get("bad")?.feedback}"`);
    expect(graded.get("good")?.verdict).toBe("correct");
    expect(graded.get("bad")?.verdict).not.toBe("correct");

    const test = await generateTestQuestions(kitId, { count: 15, types: ["mcq", "tf", "short"] });
    console.log(`  test questions=${test.length}`);
    expect(test.length).toBeGreaterThanOrEqual(12);

    const guide = await generateDocument(kitId, "guide");
    console.log(`  guide: ${guide.content.length.toLocaleString()} chars, ${guide.content.split("\n## ").length - 1} sections`);
    const summary = await generateDocument(kitId, "summary");
    console.log(`  summary: ${summary.content.length.toLocaleString()} chars`);

    const reply1 = await tutorReply(kitId, [{ role: "user", text: "Why does the cell need oxygen at all?" }], true, () => {});
    const reply2 = await tutorReply(
      kitId,
      [
        { role: "user", text: "Why does the cell need oxygen at all?" },
        { role: "model", text: reply1 },
        { role: "user", text: "Is it because oxygen accepts electrons at the end?" },
      ],
      true,
      () => {},
    );
    console.log(`  tutor: "${reply1.slice(0, 140)}…" / "${reply2.slice(0, 140)}…"`);

    const podcast = await generatePodcast(kitId, { onProgress: (d, t, s) => console.log(`  [podcast] ${s} ${d}/${t}`) });
    const audio = new Uint8Array(await audioBlob(podcast.audio!).arrayBuffer());
    console.log(`  podcast: ${podcast.durationSec}s audio, ${(audio.length / 1024 / 1024).toFixed(1)} MB`);
    expect(podcast.durationSec).toBeGreaterThan(60);
    mkdirSync("scratch", { recursive: true });
    writeFileSync("scratch/smoke-podcast.wav", audio);

    // Optional: SMOKE_YOUTUBE=<url> measures video tokens per minute at low media resolution.
    const yt = process.env.SMOKE_YOUTUBE;
    if (yt) {
      try {
        const v = await ingestYouTube(yt, { kitId });
        console.log(`  youtube: ${v.text.length.toLocaleString()} chars of notes`);
      } catch (err) {
        console.log(`  youtube: FAILED ${(err as Error).message}`);
      }
    }

    const total = calls.reduce((n, c) => n + c.costUsd, 0);
    const byTask = new Map<string, number>();
    for (const c of calls) byTask.set(c.task, (byTask.get(c.task) ?? 0) + c.costUsd);
    console.log("\nCost by task (paid-tier prices):");
    for (const [t, c] of [...byTask].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(18)} $${c.toFixed(4)}`);
    console.log(`  ${"TOTAL".padEnd(18)} $${total.toFixed(4)}  (${calls.length} calls)`);
    // After 2027-01-01 the Flash/TTS prices double.
    const in2027 = calls.reduce((n, c) => n + costOf(c.model, c.usage, new Date("2027-02-01")), 0);
    console.log(`  ${"TOTAL from 2027".padEnd(18)} $${in2027.toFixed(4)}`);
    writeFileSync("scratch/smoke-usage.json", JSON.stringify(calls, null, 2));
  });
});
