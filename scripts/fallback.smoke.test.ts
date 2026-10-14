// Live check of the model fallback: the configured model fails, a stand-in answers with the cached
// material moved inline. SMOKE_FILE=scripts/fallback.smoke.test.ts npx vitest run
import { describe, expect, it } from "vitest";
import { configureGemini, generateText, resetModelTrouble, streamText, type UsageRecord } from "../src/lib/gemini";
import { DEFAULT_SETTINGS, type Settings } from "../src/lib/settings";

const key = process.env.GEMINI_API_KEY ?? "";
// gemini-2.5-flash-lite is retired for new keys (404), which stands in for "overloaded" here.
const settings: Settings = { ...DEFAULT_SETTINGS, apiKey: key, smartModel: "gemini-2.5-flash-lite", smartThinking: "LOW" };
const calls: UsageRecord[] = [];
configureGemini({ getSettings: () => settings, onUsage: (r) => calls.push(r) });

const material = "Lecture 4. Glycolysis happens in the cytosol. Its net yield per glucose is 7 ATP in this course's made-up convention, plus 2 NADH.";
const system = "You are a study assistant. Answer only from the material.";

describe.skipIf(!key)("model fallback (real Gemini)", () => {
  it("answers a cached task on a stand-in model with the material inline", { timeout: 60_000 }, async () => {
    resetModelTrouble();
    const text = await generateText({
      role: "smart",
      task: "fallback-smoke",
      system,
      config: { cachedContent: "cachedContents/belongs-to-the-configured-model" },
      cachedMaterial: material,
      contents: [{ role: "user", parts: [{ text: "Net ATP per glucose in this course? Reply with the number only." }] }],
    });
    console.log("answer:", JSON.stringify(text), "model:", calls.at(-1)?.model);
    expect(text).toMatch(/7/);
    expect(calls.at(-1)?.model).not.toBe("gemini-2.5-flash-lite");
  });

  it("streams a tutor-style conversation on a stand-in model", { timeout: 60_000 }, async () => {
    const text = await streamText(
      {
        role: "smart",
        task: "fallback-smoke",
        system,
        config: { cachedContent: "cachedContents/belongs-to-the-configured-model" },
        cachedMaterial: material,
        contents: [
          { role: "model", parts: [{ text: "I've read your material. What would you like to work on?" }] },
          { role: "user", parts: [{ text: "Where does glycolysis happen? One word." }] },
        ],
      },
      () => {},
    );
    console.log("answer:", JSON.stringify(text), "model:", calls.at(-1)?.model);
    expect(text.toLowerCase()).toMatch(/cytosol/);
    console.log("cost", calls.map((c) => `${c.model} $${c.costUsd.toFixed(6)}`).join(", "));
  });
});
