// UI walkthrough with Gemini mocked at the network layer. Drives every page, fails on any
// console error, and saves screenshots to scratch/shots/. Needs a running server:
//   npx vite preview --port 4173 &   then   node scripts/e2e.mjs [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:4173/";
const SHOTS = "scratch/shots";
mkdirSync(SHOTS, { recursive: true });

const concepts = ["Glycolysis", "Krebs cycle", "Electron transport chain", "ATP synthase", "Fermentation", "Mitochondria"];
const usage = (i, o) => ({ promptTokenCount: i, candidatesTokenCount: o, thoughtsTokenCount: 50, totalTokenCount: i + o + 50 });

function mockJson(schemaKeys, body) {
  if (schemaKeys.includes("concepts"))
    return {
      title: "Cellular Respiration",
      description: "How cells turn glucose into ATP.",
      emoji: "🔋",
      concepts: concepts.map((name) => ({ name, summary: `Understand ${name}.` })),
    };
  if (schemaKeys.includes("cards"))
    return {
      cards: concepts.flatMap((c, i) => [
        { kind: "term", front: c, back: `Definition of ${c} number ${i}.`, concept: c },
        { kind: "qa", front: `Why does ${c} matter?`, back: `Because it makes ATP (${i}).`, concept: c },
      ]),
    };
  if (schemaKeys.includes("questions")) {
    const n = /write (\d+)/.exec(JSON.stringify(body))?.[1] ?? 8;
    return {
      questions: Array.from({ length: Number(n) }, (_, i) => {
        const type = ["mcq", "tf", "short"][i % 3];
        return {
          concept: concepts[i % concepts.length].toLowerCase(),
          type,
          difficulty: 1 + (i % 3),
          prompt: `Question ${i + 1}: what does $ATP$ do in ${concepts[i % concepts.length]}?`,
          options: type === "mcq" ? ["Stores energy", "Stores DNA", "Makes light", "Nothing"] : type === "tf" ? ["True", "False"] : [],
          answerIndex: type === "short" ? -1 : 0,
          answer: "It stores and transfers energy.",
          explanation: "ATP is the energy currency of the cell.",
          hint: "Think about what the cell spends.",
        };
      }),
    };
  }
  if (schemaKeys.includes("results")) {
    const ids = [...JSON.stringify(body).matchAll(/item id=\\"([^\\]+)\\"/g)].map((m) => m[1]);
    return { results: ids.map((id, i) => ({ id, verdict: i % 2 ? "partial" : "correct", score: i % 2 ? 0.5 : 1, feedback: "Good thinking. What about the electrons?" })) };
  }
  if (schemaKeys.includes("lines"))
    return {
      title: "Powering the cell",
      lines: Array.from({ length: 12 }, (_, i) => ({ speaker: i % 2 ? "B" : "A", text: `Line ${i} about mitochondria and ATP. `.repeat(8) })),
    };
  return {};
}

function silencePcmBase64(seconds) {
  return Buffer.alloc(24000 * 2 * seconds).toString("base64");
}

async function handle(route) {
  const req = route.request();
  const url = req.url();
  const body = req.postDataJSON?.() ?? {};
  const cfg = body.generationConfig ?? {};
  const keys = Object.keys(cfg.responseJsonSchema?.properties ?? {});
  let parts;
  let u = usage(9000, 1200);
  if (cfg.responseModalities?.includes("AUDIO")) {
    parts = [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: silencePcmBase64(3) } }];
    u = { promptTokenCount: 400, candidatesTokenCount: 75, candidatesTokensDetails: [{ modality: "AUDIO", tokenCount: 75 }], totalTokenCount: 475 };
  } else if (keys.length) {
    parts = [{ text: JSON.stringify(mockJson(keys, body)) }];
  } else {
    parts = [{ text: "# Study guide\n\n## Glycolysis\nSplits **glucose**. $C_6H_{12}O_6$\n\n| Term | Definition |\n| --- | --- |\n| ATP | energy |\n" }];
  }
  const response = { candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }], usageMetadata: u };
  if (url.includes("streamGenerateContent")) {
    const a = { candidates: [{ content: { role: "model", parts: [{ text: "What do you think happens to the " }] } }] };
    const b = { candidates: [{ content: { role: "model", parts: [{ text: "electrons at the end of the chain?" }] }, finishReason: "STOP" }], usageMetadata: u };
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify(a)}\n\ndata: ${JSON.stringify(b)}\n\n` });
  }
  await new Promise((r) => setTimeout(r, 150));
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
}

const errors = [];
const browser = await chromium.launch();

let current;
async function run(name, viewport, colorScheme) {
  const ctx = await browser.newContext({ viewport, colorScheme });
  const page = await ctx.newPage();
  current = { page, name };
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${name}] ${m.text()}`);
    if (process.env.E2E_VERBOSE) console.log(`  console.${m.type()}: ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}\n${e.stack ?? ""}`));
  await page.route(/generativelanguage\.googleapis\.com/, handle);
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${name}-${n}.png`, fullPage: true });

  await page.goto(BASE);
  await page.getByText("Create your first study kit").waitFor();
  await shot("01-home-empty");

  await page.goto(`${BASE}#/settings`);
  await page.getByPlaceholder("AIza…").fill("AIzaTEST-not-a-real-key");
  await page.getByRole("button", { name: "Test" }).click();
  await page.getByText("Key works.").waitFor();
  await shot("02-settings");

  await page.goto(`${BASE}#/new`);
  await page.getByRole("button", { name: "Paste notes" }).click();
  await page.getByPlaceholder(/Paste lecture notes/).fill("Cellular respiration converts glucose to ATP.\n".repeat(40));
  await page.getByRole("button", { name: "Add notes" }).click();
  await shot("03-new-kit");
  await page.getByRole("button", { name: "Build study kit" }).click();
  await page.getByRole("heading", { name: "Cellular Respiration" }).waitFor({ timeout: 20000 });
  await page.getByText("Smart Study").first().waitFor();
  await page.waitForTimeout(800);
  await shot("04-kit");
  const kitUrl = page.url();

  // Smart Study: answer a multiple-choice question wrong, take the hint, then right.
  await page.getByText("Smart Study").first().click();
  await page.getByText(/^Question \d+/).waitFor({ timeout: 15000 });
  await shot("05-smart-question");
  const options = page.locator("button", { hasText: /Stores DNA|Stores energy|False|True/ });
  if ((await options.count()) > 0) {
    const wrong = page.getByRole("button", { name: /Stores DNA/ });
    if (await wrong.count()) {
      await wrong.click();
      await page.getByText("Think about what the cell spends.").waitFor();
      await shot("06-smart-hint");
      await page.getByRole("button", { name: /Stores energy/ }).click();
    } else {
      await page.getByRole("button", { name: /True/ }).click();
    }
  } else {
    await page.getByPlaceholder("Explain in your own words…").fill("It stores energy");
    await page.getByRole("button", { name: "Check answer" }).click();
  }
  await page.getByRole("button", { name: "Next question" }).waitFor();
  await shot("07-smart-answered");
  await page.getByRole("button", { name: "Next question" }).click();
  await page.getByText(/^Question \d+/).waitFor();

  // Flashcards: flip and rate.
  await page.goto(`${kitUrl}/cards`);
  await page.getByText("Tap to flip").waitFor();
  await page.getByText("Tap to flip").click();
  await page.getByRole("button", { name: /Good/ }).click();
  await shot("08-flashcards");
  await page.getByRole("button", { name: "All cards" }).click();
  await shot("09-flashcards-browse");

  // Practice test: generate, answer one, submit.
  await page.goto(`${kitUrl}/test`);
  await page.getByRole("button", { name: "10", exact: true }).click();
  await page.getByRole("button", { name: /Start test/ }).click();
  await page.getByText("Q1", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /Stores energy/ }).first().click();
  await page.getByPlaceholder("Your answer").first().fill("energy");
  await page.getByRole("button", { name: "Submit test" }).click();
  await page.getByText(/^Score: \d+%/).waitFor({ timeout: 15000 });
  await shot("10-test-results");

  // Guide + summary.
  await page.goto(`${kitUrl}/guide`);
  await page.getByRole("button", { name: /Write it/ }).click();
  await page.locator("table").first().waitFor({ timeout: 15000 });
  await shot("11-guide");

  // Podcast.
  await page.goto(`${kitUrl}/podcast`);
  await page.getByRole("button", { name: /Make an episode/ }).click();
  await page.locator("audio").waitFor({ timeout: 30000 });
  await shot("12-podcast");

  // Games.
  await page.goto(`${kitUrl}/games`);
  await page.getByText("Definition Match").click();
  await page.waitForTimeout(300);
  await shot("13-match");
  await page.getByRole("button", { name: "All games" }).click();
  await page.getByText("Term Builder").click();
  await page.getByRole("button", { name: "Hint" }).click();
  await shot("14-builder");
  await page.getByRole("button", { name: "All games" }).click();
  await page.getByText("Stacker").click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForTimeout(300);
  await shot("15-stacker");

  // Tutor (streaming).
  await page.goto(`${kitUrl}/tutor`);
  await page.getByRole("button", { name: "Explain the main idea simply" }).click();
  await page.getByText("electrons at the end of the chain?").waitFor({ timeout: 15000 });
  await shot("16-tutor");

  await page.goto(`${kitUrl}/progress`);
  await page.getByText("Mastery by concept").waitFor();
  await shot("17-progress");

  await page.goto(`${kitUrl}/sources`);
  await page.getByText("Pasted", { exact: false }).first().waitFor();
  await shot("18-sources");

  await page.goto(`${BASE}#/settings`);
  await page.getByText("This month by feature").waitFor();
  await shot("19-usage");

  await page.goto(BASE);
  await page.getByText("Cellular Respiration").waitFor();
  await shot("20-home");
  await ctx.close();
}

try {
  await run("mobile", { width: 390, height: 844 }, "light");
  await run("desktop-dark", { width: 1280, height: 860 }, "dark");
} catch (err) {
  console.error("E2E FAILED:", err.message);
  await current?.page.screenshot({ path: `${SHOTS}/${current.name}-FAILED.png`, fullPage: true }).catch(() => {});
  console.error("At:", current?.page.url());
  errors.push(err.message);
} finally {
  await browser.close();
}

const real = errors.filter((e) => !/favicon|manifest|sw\.js|workbox/i.test(e));
if (real.length) {
  console.error(`\n${real.length} error(s):\n` + real.join("\n"));
  process.exit(1);
}
console.log(`E2E passed. Screenshots in ${SHOTS}/`);
