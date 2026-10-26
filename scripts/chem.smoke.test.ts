// Live check of the organic chemistry path: real Gemini, real PubChem and OPSIN. Builds a kit from
// a lecture on alkene and alkyl halide reactions, then writes Smart Study questions, flashcards and
// a reaction sheet, and reports every structure token and what checking made of it.
//
//   SMOKE_FILE=scripts/chem.smoke.test.ts just smoke     (about $0.06)
import "fake-indexeddb/auto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkTokens, identify, rdkit } from "../src/lib/chem";
import { db } from "../src/lib/db";
import { configureGemini, type UsageRecord } from "../src/lib/gemini";
import { molTokens } from "../src/lib/mol";
import { DEFAULT_SETTINGS, type Settings } from "../src/lib/settings";
import { pickTargets, targetDifficulty } from "../src/lib/smart";
import { addSources, createKit, generateReactionSheet, generateSmartQuestions } from "../src/lib/study";

const key = process.env.GEMINI_API_KEY ?? "";
const settings: Settings = { ...DEFAULT_SETTINGS, apiKey: key };
const calls: UsageRecord[] = [];
configureGemini({ getSettings: () => settings, onUsage: (r) => calls.push(r) });

const logs: string[] = [];
const info = console.info;
console.info = (...args: unknown[]) => {
  logs.push(args.join(" "));
  info(...args);
};

describe.skipIf(!key)("organic chemistry, live", () => {
  it("builds an organic chemistry kit with checked structures", { timeout: 600_000 }, async () => {
    const kitId = await createKit({ language: "auto" });
    await addSources(kitId, [{ type: "text", name: "Lecture 9", text: readFileSync("scripts/fixtures/alkenes.md", "utf8") }]);
    const kit = (await db.kits.get(kitId))!;
    console.log(`kit: ${kit.title} | subject ${kit.subject} | quantitative ${kit.quantitative} | status ${kit.status}`);
    expect(kit.subject).toBe("organic-chemistry");
    const cards = await db.flashcards.where("kitId").equals(kitId).toArray();

    const concepts = await db.concepts.where("kitId").equals(kitId).sortBy("order");
    const targets = pickTargets(concepts, 4).map((c) => ({ name: c.name, mastery: c.mastery, attempts: c.attempts, difficulty: targetDifficulty(c) }));
    const questions = await generateSmartQuestions(kitId, targets, { count: 16, types: ["mcq", "tf"] });
    const sheet = await generateReactionSheet(kitId);
    const reactions = JSON.parse(sheet.content).reactions as { name: string; substrate: string; reagents: string; product: string }[];

    // Everything that was saved: every token must draw, and report what checking said of it.
    const texts = [
      ...questions.flatMap((q) => [q.prompt, ...q.options, q.answer, q.explanation, q.hint]),
      ...cards.flatMap((c) => [c.front, c.back]),
      ...reactions.flatMap((r) => [r.substrate, r.product]),
    ];
    const verdicts = await checkTokens(texts);
    const R = await rdkit();
    const tokens = texts.flatMap(molTokens);
    const unreadable = tokens.filter((t) => !identify(R, t.smiles));
    const counts: Record<string, number> = {};
    for (const v of verdicts.values()) counts[v.status] = (counts[v.status] ?? 0) + 1;
    const structureQuestions = questions.filter((q) => q.options.length && q.options.every((o) => molTokens(o).length === 1 && !o.replace(/\{\{mol:[^}]*\}\}/, "").trim()));
    const dropped = logs.filter((l) => l.startsWith("Dropped"));

    const report = [
      `kit: ${kit.title} (${kit.subject}, quantitative ${kit.quantitative})`,
      `questions kept: ${questions.length} of 16 asked; with structure options: ${structureQuestions.length}`,
      `dropped:\n${dropped.map((d) => `  - ${d}`).join("\n") || "  (none)"}`,
      `flashcards: ${cards.length}, with structures: ${cards.filter((c) => molTokens(c.front + c.back).length).length}`,
      `reactions: ${reactions.length}`,
      `distinct saved tokens: ${verdicts.size}; after checking: ${JSON.stringify(counts)}; unreadable: ${unreadable.length}`,
      `cost: $${calls.reduce((n, c) => n + c.costUsd, 0).toFixed(4)} over ${calls.length} calls (${[...new Set(calls.map((c) => c.task))].join(", ")})`,
      "",
      "## Questions",
      ...questions.map((q) => `- [${q.type} d${q.difficulty}] ${q.prompt}\n${q.options.map((o, i) => `    ${i === q.answerIndex ? "*" : " "} ${o}`).join("\n")}\n    explanation: ${q.explanation}`),
      "",
      "## Reactions",
      ...reactions.map((r) => `- ${r.name}: ${r.substrate} + ${r.reagents} -> ${r.product}`),
      "",
      "## Cards with structures",
      ...cards.filter((c) => molTokens(c.front + c.back).length).map((c) => `- ${c.front} :: ${c.back}`),
    ].join("\n");
    writeFileSync("scratch/chem-smoke.md", report);
    console.log(report.split("\n## Questions")[0]);
    expect(unreadable).toEqual([]);
    expect(questions.length).toBeGreaterThan(8);
  });
});
