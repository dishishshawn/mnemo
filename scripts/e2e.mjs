// UI walkthrough with Gemini mocked at the network layer. Drives every page, fails on any
// console error, and saves screenshots to scratch/shots/. Needs a running server:
//   npx vite preview --port 4173 &   then   node scripts/e2e.mjs [baseUrl]
import { chromium, webkit } from "@playwright/test";
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
    const text = JSON.stringify(body);
    const n = /write (\d+)/.exec(text)?.[1] ?? 8;
    const allowed = (/Allowed types: ([a-z, ]+)\./.exec(text)?.[1] ?? "mcq, tf, short").split(", ");
    return {
      questions: Array.from({ length: Number(n) }, (_, i) => {
        const type = allowed[i % allowed.length];
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
  if (schemaKeys.includes("covered"))
    return {
      score: 0.7,
      covered: ["Glucose is split into pyruvate", "Happens in the cytoplasm"],
      missing: ["Net gain of 2 ATP and 2 NADH"],
      errors: ["It does not need oxygen: glycolysis is anaerobic."],
      tip: "Finish with the energy bookkeeping: what goes in and what comes out.",
    };
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

let cacheSeq = 0;
async function handle(route) {
  const req = route.request();
  const url = req.url();
  // Explicit context cache creation.
  if (/cachedContents/.test(url) && req.method() === "POST")
    return route.fulfill({ json: { name: `cachedContents/e2e-${++cacheSeq}`, model: "models/gemini-3.8-flash", expireTime: new Date(Date.now() + 3600e3).toISOString(), usageMetadata: { totalTokenCount: 5000 } } });
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

// In-memory stand-in for /api/sync (same semantics as api/sync.ts). Skipped with E2E_REAL_SYNC=1.
const syncStore = new Map();
let syncSeq = 0;
async function handleSync(route) {
  const req = route.request();
  const url = new URL(req.url());
  const key = `${url.searchParams.get("vault")}/${url.searchParams.get("name")}`;
  const cur = syncStore.get(key);
  const h = req.headers();
  if (req.method() === "GET") {
    if (!cur) return route.fulfill({ status: 204 });
    const tags = { ETag: `W/${cur.etag}`, "X-Etag": cur.etag }; // like Vercel's CDN
    // Playwright's WebKit can't fulfill a 304; a full 200 is equivalent for the client (merge is idempotent).
    if (engine !== webkit && h["if-none-match"]?.replace(/^W\//, "") === cur.etag) return route.fulfill({ status: 304, headers: tags });
    return route.fulfill({ status: 200, body: cur.bytes, headers: { ...tags, "Content-Type": "application/octet-stream" } });
  }
  const isState = key.endsWith("/state");
  const ifMatch = h["if-match"]?.replace(/^W\//, "");
  if (isState && ((ifMatch && cur?.etag !== ifMatch) || (!ifMatch && cur))) return route.fulfill({ status: 412, json: {} });
  const etag = `"s${++syncSeq}"`;
  syncStore.set(key, { bytes: req.postDataBuffer(), etag });
  return route.fulfill({ status: 200, json: { etag } });
}

const errors = [];
// E2E_ENGINE=webkit approximates iPhone/iPad Safari (also strips features iOS Safari lacks).
const engine = process.env.E2E_ENGINE === "webkit" ? webkit : chromium;
const browser = await engine.launch();
const iosGaps = () => {
  delete ReadableStream.prototype[Symbol.asyncIterator];
  delete ReadableStream.prototype.values;
};

let current;
async function run(name, viewport, colorScheme) {
  const ctx = await browser.newContext({ viewport, colorScheme, serviceWorkers: "block" });
  const page = await ctx.newPage();
  if (engine === webkit) await page.addInitScript(iosGaps);
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
  // The app defaults to light regardless of the OS; the dark run opts in like a user would.
  if (colorScheme === "dark") await page.getByRole("button", { name: "Dark", exact: true }).click();
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

  // Short answers: its own section, written answers only.
  await page.goto(`${kitUrl}/short`);
  await page.getByPlaceholder("Explain in your own words…").waitFor({ timeout: 15000 });
  await page.getByPlaceholder("Explain in your own words…").fill("It stores energy");
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.getByRole("button", { name: "Next question" }).waitFor({ timeout: 15000 });
  await shot("07b-short-answers");

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

  // Exam date: set it a week out and check the plan card and the forecast.
  const inAWeek = new Date(Date.now() + 7 * 86_400_000);
  const iso = `${inAWeek.getFullYear()}-${String(inAWeek.getMonth() + 1).padStart(2, "0")}-${String(inAWeek.getDate()).padStart(2, "0")}`;
  await page.goto(kitUrl);
  await page.locator('input[type="date"]').fill(iso);
  await page.getByText("Exam in 7 days").waitFor();
  await page.getByText(/of \d+ questions/).waitFor();
  await shot("16b-exam-plan");

  // Explain it back: type an explanation (dictation is the OS keyboard's job) and get it assessed.
  await page.goto(`${kitUrl}/explain`);
  await page.getByText("Pick a concept").waitFor();
  await page.getByRole("button", { name: "Glycolysis", exact: true }).click();
  await page.locator("textarea").fill("Glycolysis splits glucose into two pyruvate molecules in the cytoplasm and it needs oxygen to run.");
  await page.getByRole("button", { name: /Check my explanation/ }).click();
  await page.getByText("You skipped").waitFor({ timeout: 15000 });
  await page.getByText("Net gain of 2 ATP and 2 NADH").waitFor();
  await shot("16c-explain");
  await page.getByRole("button", { name: "Next concept" }).click();
  await page.locator("textarea").waitFor();

  await page.goto(`${kitUrl}/progress`);
  await page.getByText("Mastery by concept").waitFor();
  await page.getByText("Exam-day forecast").waitFor();
  await page.getByText("Explain it back").first().waitFor();
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

async function device(name, viewport) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await ctx.newPage();
  if (engine === webkit) await page.addInitScript(iosGaps);
  current = { page, name };
  page.on("console", (m) => m.type() === "error" && errors.push(`[${name}] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
  await page.route(/generativelanguage\.googleapis\.com/, handle);
  if (!process.env.E2E_REAL_SYNC) await page.route(/\/api\/sync/, handleSync);
  return { ctx, page };
}

/** Two devices: A builds a kit and turns on sync; B joins with the code and gets everything. */
async function runSync() {
  const a = await device("sync-A", { width: 1280, height: 860 });
  await a.page.goto(`${BASE}#/settings`);
  await a.page.getByPlaceholder("AIza…").fill("AIzaSYNC-TEST-KEY");
  await a.page.goto(`${BASE}#/new`);
  await a.page.getByRole("button", { name: "Paste notes" }).click();
  await a.page.getByPlaceholder(/Paste lecture notes/).fill("Photosynthesis turns light into sugar.\n".repeat(30));
  await a.page.getByRole("button", { name: "Add notes" }).click();
  await a.page.getByRole("button", { name: "Build study kit" }).click();
  await a.page.getByRole("heading", { name: "Cellular Respiration" }).waitFor({ timeout: 20000 });
  await a.page.getByText("12 flashcards").waitFor({ timeout: 20000 });
  await a.page.goto(`${BASE}#/settings`);
  await a.page.getByRole("button", { name: "Turn on sync (first device)" }).click();
  await a.page.getByText(/Synced (just now|\d+s ago)/).waitFor({ timeout: 20000 });
  await a.page.getByRole("button", { name: "Show code" }).click();
  const code = (await a.page.locator("code").first().textContent()).trim();
  if (!/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/.test(code)) throw new Error(`Unexpected sync code: ${code}`);
  await a.page.screenshot({ path: `${SHOTS}/sync-A-settings.png`, fullPage: true });

  const b = await device("sync-B", { width: 390, height: 844 });
  await b.page.goto(`${BASE}#/settings`);
  await b.page.getByRole("button", { name: "I have a sync code" }).click();
  await b.page.getByPlaceholder("XXXXX-XXXXX-XXXXX-XXXXX").fill(code.toLowerCase());
  await b.page.getByRole("button", { name: "Join" }).click();
  await b.page.getByText(/Synced (just now|\d+s ago)/).waitFor({ timeout: 20000 });
  if ((await b.page.getByPlaceholder("AIza…").inputValue()) !== "AIzaSYNC-TEST-KEY") throw new Error("API key didn't sync");
  await b.page.goto(BASE);
  await b.page.getByText("Cellular Respiration").click();
  await b.page.getByText("12 flashcards").waitFor({ timeout: 10000 });
  await b.page.goto(`${b.page.url()}/sources`);
  await b.page.getByText(/tokens · read by pasted/).waitFor({ timeout: 10000 });
  await b.page.screenshot({ path: `${SHOTS}/sync-B-kit-sources.png`, fullPage: true });

  // B deletes a card; A picks the deletion up on its next sync.
  await b.page.goto(`${b.page.url().replace(/\/sources$/, "")}/cards`);
  await b.page.getByRole("button", { name: "All cards" }).click();
  await b.page.getByRole("button", { name: "Delete" }).first().click();
  await b.page.goto(`${BASE}#/settings`);
  await b.page.getByRole("button", { name: /Sync now/ }).click();
  await b.page.getByText(/Synced (just now|\d+s ago)/).waitFor({ timeout: 20000 });
  await a.page.getByRole("button", { name: /Sync now/ }).click();
  await a.page.waitForTimeout(1500);
  await a.page.goto(BASE);
  await a.page.getByText("Cellular Respiration").click();
  await a.page.getByText("11 flashcards").waitFor({ timeout: 10000 });
  await a.ctx.close();
  await b.ctx.close();
}

try {
  if (process.env.E2E_ONLY !== "sync") {
    await run("mobile", { width: 390, height: 844 }, "light");
    await run("desktop-dark", { width: 1280, height: 860 }, "dark");
  }
  await runSync();
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
