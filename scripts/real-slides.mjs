// Real run of the slide features: real Gemini, real lecture PDFs, real browser. Builds a kit, then
// checks the pages were kept, does a Smart Study round (noting calculations and the slides shown
// after misses), makes diagram cards, and dumps what came out with the cost.
//   GEMINI_API_KEY=... node scripts/real-slides.mjs <baseUrl> <pdf>...
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const [BASE, ...PDFS] = process.argv.slice(2);
const KEY = process.env.GEMINI_API_KEY;
if (!BASE || !PDFS.length || !KEY) throw new Error("usage: GEMINI_API_KEY=... node scripts/real-slides.mjs <baseUrl> <pdf>...");
const OUT = "scratch/real-slides";
mkdirSync(OUT, { recursive: true });
const QUESTIONS = Number(process.env.QUESTIONS ?? 12);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 430, height: 932 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => (m.type() === "error" || m.type() === "info") && errors.push(`console.${m.type()}: ${m.text().slice(0, 300)}`));
const log = [];
const t0 = Date.now();
const note = (s) => {
  const line = `[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`;
  console.log(line);
  log.push(line);
};
const table = (store) =>
  page.evaluate(async (store) => {
    const open = indexedDB.open("mnemo");
    const db = await new Promise((r) => (open.onsuccess = () => r(open.result)));
    return new Promise((r) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => r(req.result.map((row) => ({ ...row, image: row.image ? row.image.byteLength : undefined })));
    });
  }, store);

try {
  await page.goto(`${BASE}#/settings`);
  await page.getByPlaceholder("AIza…").fill(KEY);
  await page.goto(`${BASE}#/new`);
  await page.locator('input[type="file"]').setInputFiles(PDFS);
  await page.getByRole("button", { name: "Build study kit" }).click();
  note("building kit");
  await page.getByText(/[1-9]\d* flashcards/).waitFor({ timeout: 400_000 });
  const kitUrl = page.url();
  const [kit] = await table("kits");
  note(`kit ready: ${kit.title} | subject ${kit.subject} | quantitative ${kit.quantitative}`);

  // Slides are kept after the first cards; wait for them.
  for (let i = 0; i < 120; i++) {
    const n = (await table("pages")).length;
    if (i % 10 === 0) note(`pages kept so far: ${n}`);
    if (!(await page.getByText(/Keeping the slides/).count()) && n > 0) break;
    await page.waitForTimeout(2000);
  }
  const pages = await table("pages");
  const sources = await table("sources");
  note(`pages kept: ${pages.length} (${(pages.reduce((n, p) => n + p.image, 0) / 1e6).toFixed(1)} MB)`);
  for (const s of sources) note(`source ${s.name}: via ${s.via}, ${s.text.length} chars, page markers ${(s.text.match(/<!-- page \d+ -->/g) ?? []).length}, structure tokens ${(s.text.match(/\{\{mol:/g) ?? []).length}`);
  writeFileSync(`${OUT}/sources.md`, sources.map((s) => `# ${s.name}\n\n${s.text}`).join("\n\n---\n\n"));

  // Smart Study: first option first (often wrong, so the hint and the slide show), then the second.
  await page.goto(`${kitUrl}/smart`);
  const transcript = [];
  let slides = 0;
  for (let n = 1; n <= QUESTIONS; n++) {
    await page.getByRole("button", { name: "Report this question" }).waitFor({ timeout: 180_000 });
    await page.waitForTimeout(400);
    const card = page.locator(".animate-pop").first();
    const prompt = (await card.locator(".prose").first().innerText()).trim();
    const entry = { n, prompt };
    const numeric = page.getByPlaceholder("Your answer, e.g. 3.2e8");
    if (await numeric.count()) {
      entry.type = "numeric";
      await numeric.fill("1");
      await page.getByRole("button", { name: "Check answer" }).click();
      await page.waitForTimeout(300);
      if (await page.getByRole("button", { name: "Try again" }).count()) await page.getByText("Show me the answer").click();
    } else {
      entry.type = "choice";
      const options = card.locator("button:has(span.rounded-md)");
      entry.options = (await options.allInnerTexts()).map((t) => t.replace(/^\d\s*/, "").trim());
      await options.first().click();
      await page.waitForTimeout(400);
      if (!(await page.getByRole("button", { name: /Next question|Keep going/ }).count())) {
        await options.nth(1).click();
        await page.waitForTimeout(400);
      }
      if (!(await page.getByRole("button", { name: /Next question|Keep going/ }).count())) await page.getByText("Show me the answer").click();
    }
    await page.getByRole("button", { name: /Next question|Keep going/ }).first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(600);
    entry.result = (await card.locator(".rounded-xl.p-3.text-sm.font-medium").first().innerText().catch(() => "")).trim();
    entry.slide = (await card.locator("figcaption").innerText().catch(() => "")).trim() || undefined;
    if (await card.getByText("Show the slide this is from").count()) entry.slide = "(behind the link)";
    if (entry.slide && entry.slide !== "(behind the link)") {
      slides++;
      if (slides <= 3) await page.screenshot({ path: `${OUT}/slide-${slides}.png`, fullPage: true });
    }
    if (entry.type === "numeric") await page.screenshot({ path: `${OUT}/numeric-${n}.png`, fullPage: true });
    transcript.push(entry);
    note(`Q${n} [${entry.type}] ${entry.result.split("\n")[0]} | slide: ${entry.slide ?? "-"} | ${prompt.slice(0, 80)}`);
    await page.getByRole("button", { name: /Next question|Keep going/ }).first().click();
  }
  writeFileSync(`${OUT}/smart-study.json`, JSON.stringify(transcript, null, 2));

  // Diagram cards.
  await page.goto(`${kitUrl}/cards`);
  await page.getByRole("button", { name: "Diagram cards" }).click();
  await page.getByRole("button", { name: "Find diagrams" }).click();
  note("finding diagrams");
  await page.getByText(/Made \d+ cards|No labelled diagrams/).waitFor({ timeout: 400_000 });
  note(await page.getByText(/Made \d+ cards|No labelled diagrams/).innerText());
  const figures = await table("figures");
  for (const f of figures) note(`figure p${f.page} "${f.title}" ${f.width}x${f.height}: ${f.labels.map((l) => l.text).join(", ")}`);
  writeFileSync(`${OUT}/figures.json`, JSON.stringify(figures, null, 2));
  await page.getByRole("button", { name: "All cards" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/cards-browse.png`, fullPage: true });
  // A few diagram cards up close, front and back.
  await page.getByRole("button", { name: /^Review/ }).click();
  let shots = 0;
  for (let i = 0; i < 80 && shots < 4; i++) {
    if (await page.getByText("name the highlighted part").count()) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/diagram-${shots}-front.png` });
      await page.keyboard.press("Space");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/diagram-${shots}-back.png` });
      shots++;
      await page.keyboard.press("4");
    } else {
      await page.keyboard.press("Space");
      await page.waitForTimeout(100);
      await page.keyboard.press("4");
    }
    await page.waitForTimeout(150);
  }

  const usage = await table("usage");
  const byTask = {};
  for (const u of usage) byTask[u.task] = (byTask[u.task] ?? 0) + u.costUsd;
  note(`cost by task: ${Object.entries(byTask).map(([k, v]) => `${k}=$${v.toFixed(4)}`).join(", ")}`);
  note(`TOTAL $${usage.reduce((n, u) => n + u.costUsd, 0).toFixed(4)} over ${usage.length} calls`);
} catch (err) {
  note(`FAILED: ${err.message}`);
  await page.screenshot({ path: `${OUT}/FAILED.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) note(`console:\n${errors.join("\n")}`);
  writeFileSync(`${OUT}/log.txt`, log.join("\n"));
  await browser.close();
}
