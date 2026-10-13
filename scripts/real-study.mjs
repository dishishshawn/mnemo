// Real end-to-end Smart Study run: real Gemini (key from GEMINI_API_KEY), real PDFs, real browser.
// Dumps what a student would see (concepts, source text, questions, hints, feedback) and the cost.
//   GEMINI_API_KEY=... node scripts/real-study.mjs <baseUrl> <pdf>...
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const [BASE, ...PDFS] = process.argv.slice(2);
const KEY = process.env.GEMINI_API_KEY;
if (!BASE || !PDFS.length || !KEY) throw new Error("usage: GEMINI_API_KEY=... node scripts/real-study.mjs <baseUrl> <pdf>...");
const OUT = "scratch/real";
mkdirSync(OUT, { recursive: true });
const QUESTIONS = Number(process.env.QUESTIONS ?? 10);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 430, height: 932 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const log = [];
const t0 = Date.now();
const note = (s) => {
  const line = `[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`;
  console.log(line);
  log.push(line);
};

try {
  await page.goto(`${BASE}#/settings`);
  await page.getByPlaceholder("AIza…").fill(KEY);

  await page.goto(`${BASE}#/new`);
  await page.locator('input[type="file"]').setInputFiles(PDFS);
  await page.getByRole("button", { name: "Build study kit" }).click();
  note("building kit");
  await page.getByText(/[1-9]\d* flashcards/).waitFor({ timeout: 300_000 });
  note(`kit ready: ${await page.locator("h1").first().textContent()}`);
  await page.screenshot({ path: `${OUT}/kit.png`, fullPage: true });
  const kitUrl = page.url();

  // What the kit was built from, and the concept map.
  const dump = await page.evaluate(async () => {
    const open = indexedDB.open("mnemo");
    const db = await new Promise((r) => (open.onsuccess = () => r(open.result)));
    const all = (store) =>
      new Promise((r) => {
        const req = db.transaction(store).objectStore(store).getAll();
        req.onsuccess = () => r(req.result);
      });
    return { sources: await all("sources"), concepts: await all("concepts"), cards: await all("flashcards") };
  });
  writeFileSync(
    `${OUT}/sources.md`,
    dump.sources.map((s) => `# ${s.name} (via ${s.via}, ${s.text.length} chars)\n\n${s.text}`).join("\n\n---\n\n"),
  );
  writeFileSync(`${OUT}/concepts.md`, dump.concepts.sort((a, b) => a.order - b.order).map((c) => `- **${c.name}**: ${c.summary}`).join("\n"));
  writeFileSync(`${OUT}/flashcards.md`, dump.cards.map((c) => `- ${c.front} :: ${c.back}`).join("\n"));
  note(`sources: ${dump.sources.map((s) => `${s.name.slice(0, 30)} via ${s.via} (${s.text.length} chars)`).join("; ")}`);
  note(`concepts (${dump.concepts.length}), flashcards (${dump.cards.length})`);

  // Smart Study: answer QUESTIONS questions. First try: the first option (often wrong, which
  // exercises the hint); short answers get a deliberately partial attempt.
  await page.goto(`${kitUrl}/smart`);
  const transcript = [];
  let previous = "";
  for (let n = 1; n <= QUESTIONS; n++) {
    const card = page.locator(".animate-pop").first();
    await page.getByText("Show me the answer").waitFor({ timeout: 120_000 });
    // Wait for a genuinely new question (guards against re-reading the last one).
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector(".animate-pop .prose");
        return el && el.textContent.trim() !== prev;
      },
      previous,
      { timeout: 120_000 },
    );
    await page.waitForTimeout(250); // let the entry animation settle before clicking
    const prompt = (await card.locator(".prose").first().innerText()).trim();
    if (prompt === previous) throw new Error(`Question repeated: ${prompt}`);
    previous = prompt;
    const badges = (await card.locator("span.rounded-full").allInnerTexts()).join(" | ");
    const entry = { n, badges, prompt };
    const textarea = page.getByPlaceholder("Explain in your own words…");
    if (await textarea.count()) {
      entry.type = "short";
      entry.attempt1 = "I think it has to do with nutrients and energy.";
      await textarea.fill(entry.attempt1);
      await page.getByRole("button", { name: "Check answer" }).click();
      await page.getByRole("button", { name: /Next question|Try again/ }).first().waitFor({ timeout: 60_000 });
      if (await page.getByRole("button", { name: "Try again" }).count()) {
        entry.socraticFeedback = (await card.locator(".bg-amber-50").innerText()).trim();
        await page.getByText("Show me the answer").click();
      }
    } else {
      entry.type = "choice";
      const options = card.locator("button:has(span.rounded-md)");
      entry.options = (await options.allInnerTexts()).map((t) => t.replace(/^\d\s*/, "").trim());
      await options.first().click();
      await page.waitForTimeout(400);
      if (await card.locator(".bg-amber-50").count()) {
        entry.hint = (await card.locator(".bg-amber-50").innerText()).trim();
        await options.nth(1).click();
        await page.waitForTimeout(400);
        if (!(await page.getByRole("button", { name: /Next question|Keep going/ }).count())) await page.getByText("Show me the answer").click();
      }
    }
    await page.getByRole("button", { name: /Next question|Keep going/ }).first().waitFor({ timeout: 60_000 });
    entry.result = (await card.locator(".rounded-xl.p-3.text-sm.font-medium").first().innerText().catch(() => "")).trim();
    entry.explanation = (await card.locator(".prose").last().innerText()).trim();
    transcript.push(entry);
    note(`Q${n} [${entry.type}] ${prompt.slice(0, 90)}`);
    if (n === 1 || n === QUESTIONS) await page.screenshot({ path: `${OUT}/smart-q${n}.png`, fullPage: true });
    await page.getByRole("button", { name: /Next question|Keep going/ }).first().click();
  }
  writeFileSync(`${OUT}/smart-study.json`, JSON.stringify(transcript, null, 2));

  const usage = await page.evaluate(async () => {
    const open = indexedDB.open("mnemo");
    const db = await new Promise((r) => (open.onsuccess = () => r(open.result)));
    return new Promise((r) => {
      const req = db.transaction("usage").objectStore("usage").getAll();
      req.onsuccess = () => r(req.result);
    });
  });
  const byTask = {};
  for (const u of usage) byTask[u.task] = (byTask[u.task] ?? 0) + u.costUsd;
  const total = usage.reduce((n, u) => n + u.costUsd, 0);
  writeFileSync(`${OUT}/usage.json`, JSON.stringify(usage, null, 2));
  note(`cost by task: ${Object.entries(byTask).map(([k, v]) => `${k}=$${v.toFixed(4)}`).join(", ")}`);
  note(`TOTAL $${total.toFixed(4)} over ${usage.length} calls`);
} catch (err) {
  note(`FAILED: ${err.message}`);
  await page.screenshot({ path: `${OUT}/FAILED.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) note(`page errors: ${errors.join(" | ")}`);
  writeFileSync(`${OUT}/log.txt`, log.join("\n"));
  await browser.close();
}
