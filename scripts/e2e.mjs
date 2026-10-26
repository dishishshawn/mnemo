// UI walkthrough with Gemini mocked at the network layer. Drives every page, fails on any
// console error, and saves screenshots to scratch/shots/. Needs a running server:
//   npx vite preview --port 4173 &   then   node scripts/e2e.mjs [baseUrl]
import { chromium, webkit } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:4173/";
const SHOTS = "scratch/shots";
mkdirSync(SHOTS, { recursive: true });

const concepts = ["Glycolysis", "Krebs cycle", "Electron transport chain", "ATP synthase", "Fermentation", "Mitochondria"];
const chemConcepts = ["Alkene addition", "Carbocation stability", "Elimination", "Microbial growth"];
/** Which material the mocked Gemini answers for: "bio" (the default walkthrough) or "chem" (organic chemistry). */
let scenario = "bio";

// Organic chemistry questions, cycled. Two are broken on purpose and must never reach the screen:
// a structure that contradicts its name, and a calculation whose answer disagrees with its arithmetic.
const CHEM_QUESTIONS = [
  {
    type: "mcq",
    prompt: "What is the major product when {{mol:C=CC|propene}} reacts with $\\ce{HBr}$?",
    options: ["{{mol:CC(C)Br|2-bromopropane}}", "{{mol:CCCBr|1-bromopropane}}", "{{mol:CC(C)O|propan-2-ol}}", "{{mol:CCC|propane}}"],
    answerIndex: 0,
    answer: "2-bromopropane",
    explanation: "Markovnikov addition: protonation gives the more stable secondary carbocation {{mol:C[CH+]C}}, which bromide traps.",
    hint: "Which carbocation is more stable?",
  },
  { type: "numeric", prompt: "A culture grows from $5 \\times 10^{6}$ to $3.2 \\times 10^{8}$ cells/mL. How many generations?", expression: "log2(3.2e8/5e6)", unit: "generations", options: [], answerIndex: -1, answer: "n = log2(64) = 6 generations.", explanation: "Each generation doubles the count.", hint: "How many doublings make 64?" },
  { type: "mcq", prompt: "DROPPED: which is (R)-2-bromobutane?", options: ["{{mol:CCCCBr|(R)-2-bromobutane}}", "{{mol:CC}}", "{{mol:CCO}}", "{{mol:CCN}}"], answerIndex: 0, answer: "", explanation: "", hint: "" },
  { type: "tf", prompt: "In $\\ce{CH3CH2OH ->[H2SO4][\\Delta] CH2=CH2 + H2O}$, water is eliminated.", options: ["True", "False"], answerIndex: 0, answer: "True", explanation: "Acid-catalysed dehydration.", hint: "What leaves?" },
  { type: "numeric", prompt: "DROPPED: generation time for 3 generations in 60 min?", expression: "60/3", unit: "min", options: [], answerIndex: -1, answer: "That is 30 min.", explanation: "", hint: "" },
];

const REACTIONS = [
  { name: "Hydrobromination of an alkene", concept: "alkene addition", substrate: "{{mol:C=CC|propene}}", reagents: "$\\ce{HBr}$", product: "{{mol:CC(C)Br|2-bromopropane}}", regiochemistry: "Markovnikov", stereochemistry: "", mechanism: "carbocation intermediate, rearrangements possible", notes: "With peroxides it flips to anti-Markovnikov." },
  { name: "Acid-catalysed hydration", concept: "alkene addition", substrate: "{{mol:CC(C)=C|2-methylpropene}}", reagents: "$\\ce{H2O}$, $\\ce{H2SO4}$", product: "{{mol:CC(C)(C)O|tert-butanol}}", regiochemistry: "Markovnikov", stereochemistry: "", mechanism: "carbocation intermediate", notes: "Water attacks the tertiary carbocation." },
  { name: "E2 elimination", concept: "elimination", substrate: "{{mol:CC(C)(C)Br|2-bromo-2-methylpropane}}", reagents: "$\\ce{NaOEt}$, heat", product: "{{mol:CC(C)=C|2-methylpropene}}", regiochemistry: "Zaitsev", stereochemistry: "anti-periplanar", mechanism: "concerted", notes: "A bulky base gives the Hofmann product instead." },
];

/** What PubChem and OPSIN know, for the mocked lookups. */
const KNOWN = {
  propene: "C=CC",
  "2-bromopropane": "CC(C)Br",
  "1-bromopropane": "CCCBr",
  "propan-2-ol": "CC(C)O",
  propane: "CCC",
  "(r)-2-bromobutane": "CC[C@@H](C)Br",
  "2-methylpropene": "CC(C)=C",
  "tert-butanol": "CC(C)(C)O",
  "2-bromo-2-methylpropane": "CC(C)(C)Br",
};

async function handleChemLookup(route) {
  const req = route.request();
  const url = req.url();
  const name = url.includes("pubchem")
    ? decodeURIComponent((req.postData() ?? "").replace(/^name=/, ""))
    : decodeURIComponent(url.split("/ws/")[1]?.replace(/\.json$/, "") ?? "");
  const smiles = KNOWN[name.toLowerCase()];
  const cors = { "Access-Control-Allow-Origin": "*" };
  if (!smiles) return route.fulfill({ status: 404, headers: cors, json: {} });
  return route.fulfill({ headers: cors, json: url.includes("pubchem") ? { PropertyTable: { Properties: [{ SMILES: smiles }] } } : { status: "SUCCESS", smiles } });
}

// The lecture PDF for the slides run: page 1 is text, page 2 a labelled cell diagram.
const DIAGRAM_LABELS = [
  { text: "Cell wall", x: 560, y: 470 },
  { text: "Membrane", x: 560, y: 380 },
  { text: "Ribosome", x: 560, y: 290 },
  { text: "Nucleoid", x: 560, y: 200 },
];
const PAGE_W = 792;
const PAGE_H = 612;

function makePdf() {
  const esc = (t) => t.replace(/[()\\]/g, (c) => `\\${c}`);
  const text = (x, y, size, t) => `BT /F1 ${size} Tf ${x} ${y} Td (${esc(t)}) Tj ET`;
  const page1 = [
    text(60, 520, 28, "Glycolysis and ATP"),
    text(60, 470, 16, "Glycolysis stores and transfers energy for the cell."),
    text(60, 440, 16, "ATP is the energy currency of the cell."),
  ].join("\n");
  const page2 = [
    text(60, 560, 24, "Prokaryotic cell structure"),
    "2 w 0.3 0.4 0.7 RG 120 150 300 360 re S",
    "1 w 0.2 0.2 0.2 RG 200 260 150 140 re S",
    ...DIAGRAM_LABELS.flatMap((l, i) => [`0.5 w 0 0 0 RG ${[420, 350, 330, 300][i]} ${l.y + 5} m ${l.x - 10} ${l.y + 5} l S`, text(l.x, l.y, 18, l.text)]),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>`,
    `<< /Length ${page1.length} >>\nstream\n${page1}\nendstream`,
    `<< /Length ${page2.length} >>\nstream\n${page2}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Gemini's view of the PDF: page markers, and a figure description on the diagram page. */
const PDF_TRANSCRIPT = `<!-- page 1 -->\n# Glycolysis and ATP\nGlycolysis stores and transfers energy for the cell. ATP is the energy currency of the cell.\n\n<!-- page 2 -->\n# Prokaryotic cell structure\n> Figure: a prokaryotic cell with labels Cell wall, Membrane, Ribosome, Nucleoid.`;

/** Boxes on the 0-1000 scale for the diagram labels, as Gemini would return them. */
const diagramResult = () => {
  const box = (x, y, w, h) => [Math.round(((PAGE_H - y - h) / PAGE_H) * 1000), Math.round((x / PAGE_W) * 1000), Math.round(((PAGE_H - y) / PAGE_H) * 1000), Math.round(((x + w) / PAGE_W) * 1000)];
  return {
    diagrams: [
      {
        title: "Prokaryotic cell",
        box: box(110, 140, 600, 380),
        labels: DIAGRAM_LABELS.map((l) => ({ text: l.text, box: box(l.x - 2, l.y - 5, l.text.length * 9.5 + 4, 24) })),
      },
    ],
  };
};
const usage = (i, o) => ({ promptTokenCount: i, candidatesTokenCount: o, thoughtsTokenCount: 50, totalTokenCount: i + o + 50 });

function mockJson(schemaKeys, body) {
  if (schemaKeys.includes("concepts") && scenario === "chem")
    return {
      title: "Alkene Reactions",
      description: "Additions to alkenes and eliminations that make them.",
      emoji: "🧪",
      concepts: chemConcepts.map((name) => ({ name, summary: `Understand ${name}.` })),
      subject: "organic-chemistry",
      quantitative: true,
    };
  if (schemaKeys.includes("concepts"))
    return {
      title: "Cellular Respiration",
      description: "How cells turn glucose into ATP.",
      emoji: "🔋",
      concepts: concepts.map((name) => ({ name, summary: `Understand ${name}.` })),
      subject: "biology",
      quantitative: false,
    };
  if (schemaKeys.includes("diagrams")) return diagramResult();
  if (schemaKeys.includes("reactions")) return { reactions: REACTIONS };
  if (schemaKeys.includes("questions") && scenario === "chem") {
    const n = Number(/write (\d+)/.exec(JSON.stringify(body))?.[1] ?? 8);
    return { questions: Array.from({ length: n }, (_, i) => ({ ...CHEM_QUESTIONS[i % CHEM_QUESTIONS.length], concept: chemConcepts[i % chemConcepts.length], difficulty: 1 + (i % 3) })) };
  }
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
  } else if (JSON.stringify(body).includes("Convert this document to clean")) {
    parts = [{ text: PDF_TRANSCRIPT }];
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

  // Classic study layout behind the setting: scrolling page with the concept strip inline.
  await page.goto(`${BASE}#/settings`);
  await page.getByRole("button", { name: "Classic", exact: true }).click();
  await page.goto(`${kitUrl}/smart`);
  await page.getByText(/^Question \d+/).waitFor({ timeout: 15000 });
  await page.getByText("← Back").waitFor();
  await page.getByText("Concept mastery").waitFor();
  await shot("07a-smart-classic");
  await page.goto(`${BASE}#/settings`);
  await page.getByRole("button", { name: "One screen", exact: true }).click();

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

async function device(name, viewport, colorScheme) {
  const ctx = await browser.newContext({ viewport, colorScheme, serviceWorkers: "block" });
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

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** A file Gemini fails to read can be retried: in one tap while it's kept on this device, else by picking it again. */
async function runRetry() {
  const { ctx, page } = await device("retry", { width: 390, height: 844 });
  let failReads = true;
  await page.route(/generativelanguage\.googleapis\.com/, (route) =>
    failReads && (route.request().postData() ?? "").includes("image/png")
      ? route.fulfill({ status: 400, json: { error: { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" } } })
      : handle(route),
  );
  const shot = (n) => page.screenshot({ path: `${SHOTS}/retry-${n}.png`, fullPage: true });
  const buildFrom = async (name) => {
    await page.goto(`${BASE}#/new`);
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Build study kit" }).click();
    await page.getByText("None of the material could be read.").waitFor({ timeout: 20000 });
  };

  await page.goto(`${BASE}#/settings`);
  await page.getByPlaceholder("AIza…").fill("AIzaRETRY-TEST-KEY");

  // Kept file: the kit page offers a plain retry, which reads it, maps the kit and writes cards.
  await buildFrom("slide.png");
  await shot("01-kit-failed");
  failReads = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByText("12 flashcards").waitFor({ timeout: 20000 });
  await shot("02-kit-retried");

  // A file that wasn't kept (it failed on another device) has to be picked again.
  failReads = true;
  await buildFrom("lecture.png");
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("mnemo");
        open.onsuccess = () => {
          const tx = open.result.transaction("sourceFiles", "readwrite");
          tx.objectStore("sourceFiles").clear();
          tx.oncomplete = () => (open.result.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Choose the file again" }).waitFor();
  await shot("03-kit-needs-file");
  await page.getByRole("link", { name: "Check sources" }).click();
  await page.getByText(/Gemini error \(400\)/).waitFor();
  await shot("04-sources-failed");
  failReads = false;
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "Choose file" }).click()]);
  await chooser.setFiles({ name: "lecture.png", mimeType: "image/png", buffer: PNG });
  await page.getByText(/tokens · read by/).waitFor({ timeout: 20000 });
  await shot("05-sources-retried");
  await page.goto(page.url().replace(/\/sources$/, ""));
  await page.getByText("12 flashcards").waitFor({ timeout: 20000 });
  await ctx.close();
}

/** Picks options in order until the question is done (a second miss ends it), however the options were shuffled. */
async function answerAny(page) {
  for (let i = 1; i <= 4; i++) {
    if (await page.getByRole("button", { name: /Next question|Keep going/ }).count()) return;
    const option = page.getByRole("button", { name: new RegExp(`^${i}`) }).first();
    if (await option.isEnabled()) await option.click();
    await page.waitForTimeout(100);
  }
}

/** Organic chemistry: drawn structures, checked names, calculations, reporting, difficulty, the reaction sheet. */
async function runChem(name, viewport, colorScheme) {
  scenario = "chem";
  const { ctx, page } = await device(name, viewport, colorScheme);
  await page.route(/pubchem\.ncbi\.nlm\.nih\.gov|ebi\.ac\.uk\/opsin/, handleChemLookup);
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${name}-${n}.png`, fullPage: true });
  await page.goto(`${BASE}#/settings`);
  await page.getByPlaceholder("AIza…").fill("AIzaCHEM-TEST-KEY");
  if (colorScheme === "dark") await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.goto(`${BASE}#/new`);
  await page.getByRole("button", { name: "Paste notes" }).click();
  await page.getByPlaceholder(/Paste lecture notes/).fill("Alkenes add HBr with Markovnikov selectivity through the more stable carbocation.\n".repeat(30));
  await page.getByRole("button", { name: "Add notes" }).click();
  await page.getByRole("button", { name: "Build study kit" }).click();
  await page.getByRole("heading", { name: "Alkene Reactions" }).waitFor({ timeout: 20000 });
  await page.getByText("Reaction sheet").first().waitFor();
  if ((await page.locator("select").filter({ hasText: "Organic chemistry" }).inputValue()) !== "organic-chemistry") throw new Error("Subject wasn't set from the analysis");
  await page.waitForTimeout(500);
  await shot("01-kit");
  const kitUrl = page.url();

  // Smart Study: go through questions until a drawn-structure question and a calculation have both come up.
  await page.goto(`${kitUrl}/smart`);
  let sawStructures = false;
  let sawNumeric = false;
  let reported = false;
  for (let i = 0; i < 12 && !(sawStructures && sawNumeric && reported); i++) {
    await page.getByRole("button", { name: "Report this question" }).waitFor({ timeout: 15000 });
    if (await page.getByText("DROPPED").count()) throw new Error("A question with a broken structure or calculation was shown");
    const numeric = page.getByPlaceholder("Your answer, e.g. 3.2e8");
    if (await numeric.count()) {
      await numeric.fill("5");
      await page.getByRole("button", { name: "Check answer" }).click();
      await page.getByText("Not quite: 5 isn't it.").waitFor();
      await numeric.fill("6");
      await page.getByRole("button", { name: "Try again" }).click();
      await page.getByText("Nice, that's right.").waitFor();
      await shot("03-numeric");
      sawNumeric = true;
    } else if ((await page.getByRole("img", { name: "Chemical structure" }).count()) >= 5) {
      await shot("02-structures");
      await answerAny(page);
      await page.getByText("Markovnikov addition").waitFor();
      await shot("02b-structures-answered");
      sawStructures = true;
    } else if (!reported) {
      await page.getByRole("button", { name: "Report this question" }).click();
      await page.getByRole("button", { name: "The marked answer is wrong" }).click();
      reported = true;
      await page.getByRole("dialog").waitFor({ state: "detached" }).catch(() => {});
      await page.waitForTimeout(500);
      continue;
    } else {
      await answerAny(page);
    }
    await page.getByRole("button", { name: /Next question|Keep going/ }).click();
    await page.getByRole("button", { name: /Next question|Keep going/ }).waitFor({ state: "detached" });
  }
  if (!sawStructures || !sawNumeric || !reported) throw new Error(`Smart Study run incomplete: structures ${sawStructures}, numeric ${sawNumeric}, reported ${reported}`);

  // Difficulty lives in the Steer menu.
  await page.getByRole("button", { name: "Steer" }).click();
  await page.getByRole("button", { name: "Gentle", exact: true }).click();
  await page.getByText("About 9 in 10 right").waitFor();
  await page.waitForTimeout(400);
  await shot("04-difficulty");
  await page.keyboard.press("Escape");

  // Reaction sheet: drawn, then turned into cards.
  await page.goto(`${kitUrl}/reactions`);
  await page.getByRole("button", { name: /Make the sheet/ }).click();
  await page.getByText("Hydrobromination of an alkene").waitFor({ timeout: 15000 });
  await page.getByRole("img", { name: "2-bromopropane" }).first().waitFor();
  await page.waitForTimeout(300);
  await shot("05-reactions");
  await page.getByRole("img", { name: "2-bromopropane" }).first().click();
  await page.getByText("Formula").waitFor();
  await page.getByText("C₃H₇Br").waitFor();
  await page.waitForTimeout(400);
  await shot("06-zoom");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Make flashcards" }).click();
  await page.getByText(/Added 6 cards/).waitFor();
  await page.goto(`${kitUrl}/cards`);
  await page.getByRole("button", { name: "All cards" }).click();
  await page.getByText("Which reagents?").first().waitFor();
  await page.waitForTimeout(300);
  await shot("07-reaction-cards");
  await ctx.close();
  scenario = "bio";
}

/** A lecture PDF: its slides are kept, shown after a miss, and its labelled diagram becomes cards. */
async function runSlides(name, viewport, colorScheme) {
  const { ctx, page } = await device(name, viewport, colorScheme);
  const shot = (n) => page.screenshot({ path: `${SHOTS}/${name}-${n}.png`, fullPage: true });
  await page.goto(`${BASE}#/settings`);
  await page.getByPlaceholder("AIza…").fill("AIzaSLIDES-TEST-KEY");
  if (colorScheme === "dark") await page.getByRole("button", { name: "Dark", exact: true }).click();
  await page.goto(`${BASE}#/new`);
  await page.locator('input[type="file"]').setInputFiles({ name: "Lecture 3.pdf", mimeType: "application/pdf", buffer: makePdf() });
  await page.getByRole("button", { name: "Build study kit" }).click();
  await page.getByRole("heading", { name: "Cellular Respiration" }).waitFor({ timeout: 20000 });
  const kitUrl = page.url();
  // The slides are kept after the kit is ready; the diagram button appears once they're in.
  await page.goto(`${kitUrl}/cards`);
  await page.getByRole("button", { name: "Diagram cards" }).waitFor({ timeout: 30000 });

  // A miss shows the slide the question came from.
  await page.goto(`${kitUrl}/smart`);
  await page.getByText(/^Question \d+/).waitFor({ timeout: 15000 });
  for (let i = 0; i < 6 && !(await page.getByRole("button", { name: /Stores DNA/ }).count()); i++) {
    await page.getByRole("button", { name: /True|Stores energy/ }).first().click();
    await page.getByRole("button", { name: "Next question" }).click();
    await page.getByText(/^Question \d+/).waitFor();
  }
  await page.getByRole("button", { name: /Stores DNA/ }).click();
  await page.getByRole("button", { name: /Makes light/ }).click();
  await page.getByText(/From Lecture 3, page 1/).waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await shot("01-slide-after-miss");

  // Diagram cards from the labelled diagram on page 2.
  await page.goto(`${kitUrl}/cards`);
  await page.getByRole("button", { name: "Diagram cards" }).click();
  await page.getByRole("button", { name: "Find diagrams" }).click();
  await page.getByText(/Made 4 cards from 1 diagram/).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "All cards" }).click();
  await page.getByText("Diagram card · Prokaryotic cell").first().waitFor();
  await shot("02-diagram-cards");
  await page.getByRole("button", { name: /^Review/ }).click();
  // Space flips, 4 is Easy: clear the text cards until a diagram card comes up.
  for (let i = 0; i < 40 && !(await page.getByText("name the highlighted part").count()); i++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(120);
    await page.keyboard.press("4");
    await page.waitForTimeout(120);
  }
  await page.getByText("name the highlighted part").waitFor();
  await page.waitForTimeout(300);
  await shot("03-diagram-front");
  await page.getByText("name the highlighted part").click();
  await page.waitForTimeout(300);
  await shot("04-diagram-back");
  await ctx.close();
}

try {
  if (process.env.E2E_ONLY === "chem") {
    await runChem("chem-mobile", { width: 390, height: 844 }, "light");
    await runChem("chem-desktop-dark", { width: 1280, height: 860 }, "dark");
  } else if (process.env.E2E_ONLY === "slides") {
    await runSlides("slides-mobile", { width: 390, height: 844 }, "light");
    await runSlides("slides-desktop-dark", { width: 1280, height: 860 }, "dark");
  } else if (process.env.E2E_ONLY === "retry") await runRetry();
  else if (process.env.E2E_ONLY !== "sync") {
    await run("mobile", { width: 390, height: 844 }, "light");
    await run("desktop-dark", { width: 1280, height: 860 }, "dark");
    await runRetry();
    await runChem("chem-mobile", { width: 390, height: 844 }, "light");
    await runChem("chem-desktop-dark", { width: 1280, height: 860 }, "dark");
    await runSlides("slides-mobile", { width: 390, height: 844 }, "light");
    await runSlides("slides-desktop-dark", { width: 1280, height: 860 }, "dark");
  }
  if (!["retry", "chem", "slides"].includes(process.env.E2E_ONLY)) await runSync();
} catch (err) {
  console.error("E2E FAILED:", err.message);
  await current?.page.screenshot({ path: `${SHOTS}/${current.name}-FAILED.png`, fullPage: true }).catch(() => {});
  console.error("At:", current?.page.url());
  errors.push(err.message);
} finally {
  await browser.close();
}

// The retry run fails Gemini reads on purpose; browsers log those responses as errors.
const real = errors.filter((e) => !/favicon|manifest|sw\.js|workbox/i.test(e) && !/^\[retry\] Failed to load resource: the server responded with a status of 400/.test(e));
if (real.length) {
  console.error(`\n${real.length} error(s):\n` + real.join("\n"));
  process.exit(1);
}
console.log(`E2E passed. Screenshots in ${SHOTS}/`);
