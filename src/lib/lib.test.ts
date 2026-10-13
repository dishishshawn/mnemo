import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { costOf, ratesAt } from "./pricing";
import { applyAnswer, levelOf, pickQuestion, pickTargets, targetDifficulty } from "./smart";
import type { Concept, Question } from "./db";
import { newCard, review, Rating } from "./srs";
import { pcmToWav } from "./wav";
import { decodeAudio, parseJson } from "./gemini";
import { chunkScript, fitScript } from "./study";
import { choosePdfReader, stripFence } from "./ingest";
import { youtubeId } from "./extract";

describe("pricing", () => {
  it("prices text, thinking, and cached tokens", () => {
    const at = new Date("2026-10-13T00:00:00Z");
    // 100k prompt (20k cached) + 4k output + 1k thinking on 3.8 Flash.
    const usd = costOf(
      "gemini-3.8-flash",
      { promptTokenCount: 100_000, cachedContentTokenCount: 20_000, candidatesTokenCount: 4_000, thoughtsTokenCount: 1_000 },
      at,
    );
    expect(usd).toBeCloseTo((80_000 * 0.75 + 20_000 * 0.075 + 5_000 * 3.75) / 1e6, 10);
  });

  it("applies the scheduled 2027 price increase", () => {
    expect(ratesAt("gemini-3.8-flash", new Date("2026-12-31T12:00:00Z"))!.input).toBe(0.75);
    expect(ratesAt("gemini-3.8-flash", new Date("2027-01-01T00:00:01Z"))!.input).toBe(1.5);
  });

  it("uses the separate audio input rate where a model has one", () => {
    const usd = costOf("gemini-3.1-flash-lite", {
      promptTokenCount: 1_000_000,
      promptTokensDetails: [
        { modality: "AUDIO", tokenCount: 900_000 },
        { modality: "TEXT", tokenCount: 100_000 },
      ],
      candidatesTokenCount: 0,
    });
    expect(usd).toBeCloseTo(0.9 * 0.5 + 0.1 * 0.25, 10);
  });

  it("prices TTS audio output", () => {
    const usd = costOf(
      "gemini-3.8-flash-lite-tts",
      {
        promptTokenCount: 500,
        candidatesTokenCount: 15_000,
        candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 15_000 }],
      },
      new Date("2026-10-13"),
    );
    // 10 minutes of audio = 15k tokens at $6/M = $0.09.
    expect(usd).toBeCloseTo((500 * 0.5 + 15_000 * 6) / 1e6, 10);
  });

  it("returns 0 for unknown models", () => {
    expect(costOf("nope", { promptTokenCount: 10 })).toBe(0);
  });
});

const concept = (name: string, patch: Partial<Concept> = {}): Concept => ({
  id: name,
  kitId: "k",
  name,
  summary: "",
  order: 0,
  srs: newCard(new Date("2026-01-01")),
  attempts: 0,
  correct: 0,
  mastery: 0,
  ...patch,
});

const question = (concept: string, difficulty: 1 | 2 | 3, patch: Partial<Question> = {}): Question => ({
  id: `${concept}-${difficulty}-${Math.random()}`,
  kitId: "k",
  concept,
  type: "mcq",
  difficulty,
  prompt: "?",
  options: ["a", "b", "c", "d"],
  answerIndex: 0,
  answer: "a",
  explanation: "",
  hint: "",
  origin: "smart",
  createdAt: 0,
  ...patch,
});

describe("smart study", () => {
  const now = new Date("2026-10-13T12:00:00Z");

  it("levels and difficulty rise with mastery", () => {
    expect(levelOf({ attempts: 0, mastery: 0 })).toBe("new");
    expect(targetDifficulty({ attempts: 3, mastery: 0.2 })).toBe(1);
    expect(targetDifficulty({ attempts: 3, mastery: 0.6 })).toBe(2);
    expect(targetDifficulty({ attempts: 3, mastery: 0.9 })).toBe(3);
  });

  it("puts due reviews before weak, new, and strong concepts", () => {
    const due = concept("due", { attempts: 2, mastery: 0.8, srs: review(newCard(new Date("2026-01-01")), Rating.Good, new Date("2026-01-01")) });
    const weak = concept("weak", { attempts: 2, mastery: 0.2, srs: { ...newCard(), due: new Date("2027-01-01"), state: 2 } });
    const fresh = concept("fresh", { order: 3 });
    const strong = concept("strong", { attempts: 5, mastery: 0.9, srs: { ...newCard(), due: new Date("2027-01-01"), state: 2 } });
    expect(pickTargets([strong, fresh, weak, due], 4, now).map((c) => c.name)).toEqual(["due", "weak", "fresh", "strong"]);
  });

  it("interleaves review with new concepts instead of drilling only the weak ones", () => {
    const notDue = { ...newCard(), due: new Date("2027-01-01"), state: 2 };
    const weak = [0, 1, 2].map((i) => concept(`weak${i}`, { order: i, attempts: 2, mastery: 0.1, srs: notDue }));
    const fresh = [3, 4, 5, 6, 7, 8].map((i) => concept(`new${i}`, { order: i }));
    const picked = pickTargets([...weak, ...fresh], 4, now).map((c) => c.name);
    expect(picked).toEqual(["weak0", "weak1", "new3", "new4"]);
  });

  it("fills with new concepts when there's nothing to review", () => {
    const fresh = [0, 1, 2, 3, 4].map((i) => concept(`new${i}`, { order: i }));
    expect(pickTargets(fresh, 4, now).map((c) => c.name)).toEqual(["new0", "new1", "new2", "new3"]);
  });

  it("respects a steering focus", () => {
    const a = concept("Mitosis");
    const b = concept("Meiosis", { order: 1 });
    expect(pickTargets([a, b], 2, now, ["meiosis"]).map((c) => c.name)).toEqual(["Meiosis"]);
  });

  it("picks the question closest to the target difficulty and skips asked ones", () => {
    const c = concept("x", { attempts: 4, mastery: 0.9 });
    const easy = question("x", 1);
    const hard = question("x", 3);
    const asked = question("x", 3, { askedAt: 1 });
    expect(pickQuestion([easy, asked, hard], [c])).toBe(hard);
  });

  it("avoids repeating the same concept when another target has questions", () => {
    const a = concept("a");
    const b = concept("b");
    const qa = question("a", 1);
    const qb = question("b", 1);
    expect(pickQuestion([qa, qb], [a, b], ["a"])).toBe(qb);
  });

  it("mastery grows with correct answers and hints count for less", () => {
    let c = concept("x");
    c = applyAnswer(c, 1, false, now);
    expect(c.mastery).toBeCloseTo(0.5);
    const withHint = applyAnswer(c, 1, true, now);
    const without = applyAnswer(c, 1, false, now);
    expect(without.mastery).toBeGreaterThan(withHint.mastery);
    expect(without.srs.due.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("audio", () => {
  it("builds a valid WAV with gaps between chunks", () => {
    const a = new Uint8Array(480).fill(1);
    const b = new Uint8Array(480).fill(2);
    const wav = pcmToWav([a, b], 24000, 10);
    const v = new DataView(wav.buffer);
    const gapBytes = 240 * 2;
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint32(40, true)).toBe(960 + gapBytes);
    expect(wav.length).toBe(44 + 960 + gapBytes);
  });

  it("decodes both raw PCM and WAV from Gemini TTS", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    expect(decodeAudio(pcm, "audio/L16;codec=pcm;rate=16000")).toEqual({ pcm, sampleRate: 16000 });
    const wav = pcmToWav([new Uint8Array(100).fill(7)], 22050, 0);
    const out = decodeAudio(wav, "audio/wav");
    expect(out.sampleRate).toBe(22050);
    expect(out.pcm.length).toBe(100);
    expect(out.pcm[0]).toBe(7);
  });
});

describe("parsing", () => {
  it("parses JSON with or without code fences", () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseJson("{nope")).toThrow(/malformed/);
  });

  it("strips a fence wrapping a whole Markdown answer", () => {
    expect(stripFence("```markdown\n# Hi\n```")).toBe("# Hi");
    expect(stripFence("# Hi\n```js\nx\n```")).toBe("# Hi\n```js\nx\n```");
  });

  it("chunks podcast scripts on turn boundaries", () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ speaker: (i % 2 ? "B" : "A") as "A" | "B", text: "x".repeat(500) }));
    const chunks = chunkScript(lines, 1800);
    expect(chunks.map((c) => c.length)).toEqual([3, 3, 3, 1]);
    expect(chunks.flat()).toEqual(lines);
  });

  it("extracts YouTube ids from common URL shapes", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://example.com")).toBeNull();
  });
});

describe("jobs", () => {
  it("a cancelled job settling late doesn't remove its replacement", async () => {
    const { runJob, cancelJob } = await import("./jobs");
    const peek = async () => (await import("./jobs")).__peek?.("k");
    let finishFirst!: () => void;
    runJob("k", () => new Promise<void>((r) => (finishFirst = r)));
    cancelJob("k");
    let report!: (s: string) => void;
    runJob("k", ({ report: rep }) => {
      report = rep;
      return new Promise<void>(() => {});
    });
    report("second running");
    finishFirst();
    await new Promise((r) => setTimeout(r, 0));
    expect(await peek()).toMatchObject({ status: "second running" });
  });
});

describe("usage projection", () => {
  it("doesn't understate spend in the first hours of a month", async () => {
    const { projectMonth } = await import("./usage");
    // 6 hours into October (31 days), $0.10 spent -> $0.40/day pace -> $12.40.
    const now = new Date(2026, 9, 1, 6, 0, 0);
    expect(projectMonth(0.1, now)).toBeCloseTo(12.4, 1);
  });
});

describe("podcast length", () => {
  const line = (i: number, words = 20) => ({ speaker: (i % 2 ? "B" : "A") as "A" | "B", text: `w${i} `.repeat(words).trim() });

  it("leaves scripts within budget alone", () => {
    const lines = Array.from({ length: 10 }, (_, i) => line(i));
    expect(fitScript(lines, 450)).toEqual(lines);
  });

  it("trims an overlong script to ~budget, keeping the opening and the recap", () => {
    const lines = Array.from({ length: 100 }, (_, i) => line(i)); // 2,000 words
    const out = fitScript(lines, 450);
    const words = out.reduce((n, l) => n + l.text.split(" ").length, 0);
    expect(words).toBeLessThanOrEqual(450 * 1.15);
    expect(out[0]).toBe(lines[0]);
    expect(out.slice(-6)).toEqual(lines.slice(-6));
  });
});

describe("PDF reader choice", () => {
  it("reads slides and short PDFs with Gemini, long text-dense ones locally", () => {
    expect(choosePdfReader(8, 244, "auto")).toBe("ai"); // the 8-slide lecture deck
    expect(choosePdfReader(21, 500, "auto")).toBe("ai");
    expect(choosePdfReader(300, 3200, "auto")).toBe("local"); // textbook
    expect(choosePdfReader(300, 3200, "ai")).toBe("ai");
    expect(choosePdfReader(8, 244, "local")).toBe("local");
    expect(choosePdfReader(40, 50, "local")).toBe("ai"); // scanned: local text is useless
  });
});
