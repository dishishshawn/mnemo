// One real Gemini call for Explain it back. SMOKE_FILE=scripts/explain.smoke.test.ts npx vitest run
import "fake-indexeddb/auto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { db, newId } from "../src/lib/db";
import { configureGemini, type UsageRecord } from "../src/lib/gemini";
import { DEFAULT_SETTINGS, type Settings } from "../src/lib/settings";
import { newCard } from "../src/lib/srs";
import { assessExplanation } from "../src/lib/study";

const key = process.env.GEMINI_API_KEY ?? "";
const settings: Settings = { ...DEFAULT_SETTINGS, apiKey: key };
const calls: UsageRecord[] = [];
configureGemini({ getSettings: () => settings, onUsage: (r) => calls.push(r) });

describe.skipIf(!key)("Explain it back (real Gemini)", () => {
  it("assesses a spoken-style explanation", { timeout: 60_000 }, async () => {
    const cache = "scratch/smoke-material.md";
    const text = existsSync(cache) ? readFileSync(cache, "utf8") : "Glycolysis is the metabolic pathway that converts glucose into pyruvate, producing a net 2 ATP and 2 NADH. It occurs in the cytosol and does not require oxygen.";
    const kitId = newId();
    await db.kits.add({ id: kitId, title: "Smoke", description: "", emoji: "🔋", language: "English", status: "ready", createdAt: Date.now(), updatedAt: Date.now() });
    await db.sources.add({ id: newId(), kitId, kind: "text", name: "notes", text, status: "ready", createdAt: Date.now() });
    const concept = { id: newId(), kitId, name: "Glycolysis", summary: "Breaking glucose down to pyruvate in the cytosol", order: 0, srs: newCard(), attempts: 0, correct: 0, mastery: 0 };
    const res = await assessExplanation(
      kitId,
      concept,
      "so um glycolysis is basically where the cell takes glucose and like splits it into two pyruvate things, it happens in the cytoplasm I think, and uh you need oxygen for it to work, and you get a bit of ATP out of it, like two",
    );
    console.log(JSON.stringify(res, null, 2));
    console.log("cost", calls.map((c) => `${c.model} $${c.costUsd.toFixed(5)}`).join(", "));
    expect(res.score).toBeGreaterThan(0.2);
    expect(res.score).toBeLessThan(0.9);
    expect(res.errors.join(" ").toLowerCase()).toMatch(/oxygen|anaerobic/);
  });
});
