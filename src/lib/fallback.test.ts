import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import {
  configureGemini,
  GeminiError,
  inlineMaterial,
  isOverloaded,
  modelChain,
  resetModelTrouble,
  streamText,
  type UsageRecord,
  withFallback,
} from "./gemini";

// A fake SDK whose stream fails on its first event for the busy model, the way Gemini reports
// "high demand" mid-stream, and streams normally for any other model.
const BUSY = new Set<string>();
vi.mock("@google/genai", async (orig) => ({
  ...(await orig<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = {
      generateContentStream: async ({ model }: { model: string }) =>
        (async function* () {
          if (BUSY.has(model)) throw apiError(503, HIGH_DEMAND);
          yield { text: "Hello ", usageMetadata: undefined };
          yield { text: "there.", usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 } };
        })(),
    };
  },
}));

/** Shaped like the SDK's ApiError: a status plus Google's JSON error as the message. */
function apiError(status: number, message: string) {
  return Object.assign(new Error(JSON.stringify({ error: { code: status, message } })), { status, name: "ApiError" });
}
const HIGH_DEMAND = "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.";
const noWait = { sleep: async () => {} };

beforeEach(() => {
  resetModelTrouble();
  BUSY.clear();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("overload detection", () => {
  it("recognises high demand whatever status it arrives with", () => {
    expect(isOverloaded(apiError(503, HIGH_DEMAND))).toBe(true);
    expect(isOverloaded(apiError(403, HIGH_DEMAND))).toBe(true);
    expect(isOverloaded(apiError(503, "The model is overloaded."))).toBe(true);
    expect(isOverloaded(apiError(403, "Permission denied on this model."))).toBe(false);
    expect(isOverloaded(apiError(429, "Quota exceeded. Please try again later."))).toBe(false);
  });
});

describe("model fallback", () => {
  it("moves to a stand-in model when the configured one is overloaded", async () => {
    const seen: string[] = [];
    const { value, model } = await withFallback(
      "gemini-3.8-flash",
      async ({ model }) => {
        seen.push(model);
        if (model === "gemini-3.8-flash") throw apiError(503, HIGH_DEMAND);
        return "ok";
      },
      noWait,
    );
    expect(value).toBe("ok");
    expect(model).toBe("gemini-3.5-flash-lite");
    // One quick retry on the busy model, then the stand-in.
    expect(seen).toEqual(["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite"]);
  });

  it("tries the stand-in first for a while after the configured model was busy", async () => {
    await withFallback("gemini-3.8-flash", async ({ model }) => {
      if (model === "gemini-3.8-flash") throw apiError(503, HIGH_DEMAND);
      return "ok";
    }, noWait);
    expect(modelChain("gemini-3.8-flash")[0]).toBe("gemini-3.5-flash-lite");
    expect(modelChain("gemini-3.8-flash", Date.now() + 3 * 60_000)[0]).toBe("gemini-3.8-flash");
  });

  it("doesn't sideline a model that recovered on its quick retry", async () => {
    let calls = 0;
    await withFallback("gemini-3.8-flash", async () => {
      if (calls++ === 0) throw apiError(503, HIGH_DEMAND);
      return "ok";
    }, noWait);
    expect(modelChain("gemini-3.8-flash")[0]).toBe("gemini-3.8-flash");
  });

  it("waits and goes round again when every model is rate-limited", async () => {
    const seen: string[] = [];
    const { model } = await withFallback("gemini-3.8-flash-lite-tts", async ({ model }) => {
      seen.push(model);
      if (seen.length <= 2) throw apiError(429, "Quota exceeded for this model.");
      return "audio";
    }, noWait);
    expect(seen).toEqual(["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]);
    expect(model).toBe("gemini-3.8-flash-lite-tts");
  });

  it("moves on at once for a per-model rate limit", async () => {
    const seen: string[] = [];
    await withFallback("gemini-3.1-flash-lite", async ({ model }) => {
      seen.push(model);
      if (model === "gemini-3.1-flash-lite") throw apiError(429, "Quota exceeded for this model.");
      return "ok";
    }, noWait);
    expect(seen).toEqual(["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]);
  });

  it("says it's Google's side, and which models it tried, when every model is busy", async () => {
    const err = await withFallback("gemini-3.8-flash", async () => {
      throw apiError(503, HIGH_DEMAND);
    }, noWait).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect(err.code).toBe("busy");
    expect(err.message).toMatch(/not your key/);
    expect(err.message).toMatch(/Gemini 3\.8 Flash, Gemini 3\.5 Flash-Lite and Gemini 3\.1 Flash-Lite/);
  });

  it("stays on one model, with spaced retries, when it can't switch", async () => {
    const seen: string[] = [];
    const err = await withFallback("gemini-3.8-flash", async ({ model }) => {
      seen.push(model);
      throw apiError(503, HIGH_DEMAND);
    }, { ...noWait, canSwitch: false }).catch((e) => e);
    expect(err.code).toBe("busy");
    expect(seen).toEqual(Array(4).fill("gemini-3.8-flash"));
  });

  it("doesn't switch models for errors that aren't about the model", async () => {
    const seen: string[] = [];
    const err = await withFallback("gemini-3.8-flash", async ({ model }) => {
      seen.push(model);
      throw apiError(400, "Request contains an invalid argument.");
    }, noWait).catch((e) => e);
    expect(seen).toEqual(["gemini-3.8-flash"]);
    expect(err.code).toBe("api");
  });
});

describe("streaming fallback", () => {
  it("switches models when high demand arrives as the stream's first event", async () => {
    const usage: UsageRecord[] = [];
    configureGemini({ getSettings: () => ({ ...DEFAULT_SETTINGS, apiKey: "test" }), onUsage: (r) => usage.push(r) });
    BUSY.add("gemini-3.8-flash");
    const shown: string[] = [];
    const text = await streamText({ role: "smart", task: "tutor", contents: "Hi" }, (t) => shown.push(t));
    expect(text).toBe("Hello there.");
    expect(shown).toEqual(["Hello ", "Hello there."]);
    expect(usage.at(-1)?.model).toBe("gemini-3.5-flash-lite");
  });
});

describe("inlineMaterial", () => {
  const material = { text: "<material>\nNOTES\n</material>" };

  it("puts the material before the task, like an uncached call", () => {
    const out = inlineMaterial([{ role: "user", parts: [{ text: "Make 5 flashcards." }] }], "NOTES");
    expect(out).toEqual([{ role: "user", parts: [material, { text: "Make 5 flashcards." }] }]);
  });

  it("adds a material turn in front of a conversation that starts with the model", () => {
    const chat = [
      { role: "model", parts: [{ text: "I've read your material." }] },
      { role: "user", parts: [{ text: "Explain glycolysis." }] },
    ];
    expect(inlineMaterial(chat, "NOTES")).toEqual([{ role: "user", parts: [material] }, ...chat]);
  });
});
