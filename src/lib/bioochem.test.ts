import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { checkCalculation, evaluate, formatNumber, matches, numbersIn, parseAnswer } from "./calc";
import { checkItems, checkQuestions, checkTokens, configureChem, mirror, nameHasStereo, rdkit, verifyMol } from "./chem";
import { db, type Concept, type Question } from "./db";
import { conceptFor, namesAPart, padded, toFraction, usableLabels } from "./figures";
import { hasMol, molsAsText, molTokens, onlyMols, repairMolTokens } from "./mol";
import { bestPage, pageTexts, words } from "./pages";
import { MOL_RULE, NUMERIC_RULE, questionGuidance, questionTask } from "./prompts";
import { applyAnswer, atLevel, CHALLENGES, isAskable, levelValue, recentShift, stepLevel, targetDifficulty, type Challenge } from "./smart";
import { newCard } from "./srs";

// ---------- Difficulty ----------

describe("difficulty", () => {
  it("settles near the share of right answers the setting asks for", () => {
    // A student who gets difficulty 1 right every time, 2 at 80%, 3 at 60%; questions come at the rounded level.
    const p = (difficulty: number) => 1.2 - 0.2 * difficulty;
    const share = (challenge: Challenge) => {
      let level = 1;
      let right = 0;
      let n = 0;
      let seed = 7;
      const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 100_000; i++) {
        const ok = rand() < p(targetDifficulty({ attempts: 1, mastery: 0, level }));
        if (i > 1000) {
          n++;
          right += ok ? 1 : 0;
        }
        level = stepLevel(level, ok ? 1 : 0, false, challenge);
      }
      return right / n;
    };
    const gentle = share("gentle");
    const balanced = share("balanced");
    const push = share("push");
    expect(Math.abs(gentle - 0.9)).toBeLessThan(0.03);
    expect(Math.abs(balanced - 0.8)).toBeLessThan(0.03);
    // Push's level would sit above 3 for this student; capped there, it lands a little easier than asked.
    expect(Math.abs(push - 0.65)).toBeLessThan(0.08);
    expect(gentle).toBeGreaterThan(balanced);
    expect(balanced).toBeGreaterThan(push);
  });

  it("drops a full level on a miss, climbs slowly, and treats a hint as a miss", () => {
    expect(stepLevel(2.5, 0, false, "balanced")).toBe(1.5);
    expect(stepLevel(2, 1, false, "balanced")).toBeCloseTo(2.25);
    expect(stepLevel(2, 1, false, "gentle")).toBeCloseTo(2 + 1 / 9);
    expect(stepLevel(2, 1, true, "balanced")).toBe(1);
    expect(stepLevel(3, 1, false, "push")).toBe(3);
    expect(stepLevel(1, 0, false, "push")).toBe(1);
  });

  it("eases off after a bad run and nudges up after a great one", () => {
    const run = (rights: number, of = 10) => Array.from({ length: of }, (_, i) => ({ score: i < rights ? 1 : 0, usedHint: false }));
    expect(recentShift(run(2, 4), "balanced")).toBe(0); // too few to say
    expect(recentShift(run(5), "balanced")).toBeCloseTo(-0.75);
    expect(recentShift(run(8), "balanced")).toBeCloseTo(0);
    expect(recentShift(run(10), "balanced")).toBeCloseTo(0.5);
    expect(recentShift(run(10), "push")).toBeCloseTo(0.5);
    expect(recentShift(run(0), "gentle")).toBe(-1);
  });

  it("aims at the concept's level plus the shift", () => {
    expect(targetDifficulty({ attempts: 5, mastery: 0.9, level: 2.4 })).toBe(2);
    expect(targetDifficulty({ attempts: 5, mastery: 0.9, level: 2.4 }, CHALLENGES.gentle.shift)).toBe(2);
    expect(targetDifficulty({ attempts: 5, mastery: 0.9, level: 2.4 }, -0.75)).toBe(2);
    expect(targetDifficulty({ attempts: 5, mastery: 0.9, level: 2.2 }, -0.75)).toBe(1);
    expect(targetDifficulty({ attempts: 5, mastery: 0.9, level: 2.4 }, CHALLENGES.push.shift)).toBe(3);
    expect(targetDifficulty({ attempts: 0, mastery: 0 }, 5)).toBe(3);
    expect(levelValue({ attempts: 2, mastery: 0.5 })).toBeCloseTo(1.75);
  });

  it("moves the level only for questions, not for Explain it back", () => {
    const c: Concept = { id: "c", kitId: "k", name: "c", summary: "", order: 0, srs: newCard(), attempts: 0, correct: 0, mastery: 0 };
    expect(applyAnswer(c, 1, false, new Date(), "balanced").level).toBeCloseTo(1.25);
    expect(applyAnswer(c, 1, false).level).toBeUndefined();
  });

  it("counts the pool's questions written at the levels the targets are at now", () => {
    const c: Concept = { id: "c", kitId: "k", name: "Glycolysis", summary: "", order: 0, srs: newCard(), attempts: 3, correct: 3, mastery: 0.6, level: 2 };
    const q = (difficulty: 1 | 2 | 3, patch: Partial<Question> = {}) => ({ id: String(Math.random()), concept: "glycolysis", difficulty, origin: "smart", ...patch }) as Question;
    const pool = [q(2), q(2), q(3), q(1), q(2, { flagged: "wrong" })];
    expect(atLevel(pool, [c])).toBe(2);
    expect(atLevel(pool, [c], -1)).toBe(1);
  });

  it("never asks a question that was reported", () => {
    const q = { origin: "smart", flagged: "The marked answer is wrong" } as Question;
    expect(isAskable(q)).toBe(false);
    expect(isAskable({ ...q, flagged: undefined })).toBe(true);
  });
});

describe("question prompt", () => {
  it("asks for each concept's difficulty, the subject's styles and reported mistakes", () => {
    const task = questionTask({
      language: "auto",
      count: 8,
      targets: [
        { name: "Alkene addition", mastery: 0, attempts: 0, difficulty: 1 },
        { name: "SN2", mastery: 0.8, attempts: 4, difficulty: 3 },
      ],
      types: ["mcq", "tf", "numeric"],
      avoid: [],
      purpose: "smart",
      reported: [{ prompt: "What is 2+2?", reason: "The marked answer is wrong" }],
      guidance: questionGuidance("organic-chemistry"),
    });
    expect(task).toContain("- Alkene addition (new): difficulty 1");
    expect(task).toContain("- SN2 (strong): difficulty 3");
    expect(task).toContain("Write each concept's questions at the difficulty listed for it.");
    expect(task).toContain(NUMERIC_RULE);
    expect(task).toContain(MOL_RULE);
    expect(task).toContain("predict the major product");
    expect(task).toContain('- "What is 2+2?" (The marked answer is wrong)');
  });

  it("keeps structure tokens out of biology and adds its notation", () => {
    const bio = questionGuidance("biology");
    expect(bio).not.toContain("{{mol:");
    expect(bio).toContain("Italicise genus and species");
    expect(questionGuidance(undefined)).toBe("");
  });
});

// ---------- Calculations ----------

describe("calculations", () => {
  it("evaluates arithmetic and refuses anything else", () => {
    expect(evaluate("log2(3.2e8/5e6)")).toBeCloseTo(6);
    expect(evaluate("2^3^2")).toBe(512);
    expect(evaluate("-2^2")).toBe(-4);
    expect(evaluate("0.693 / 0.035")).toBeCloseTo(19.8, 1);
    expect(evaluate("3.2 × 10^8")).toBeCloseTo(3.2e8);
    expect(evaluate("ln(e) + sqrt(16) − 1")).toBe(4);
    expect(evaluate("1.5 x 10^-3")).toBeCloseTo(0.0015);
    expect(() => evaluate("2 cells")).toThrow();
    expect(() => evaluate("alert(1)")).toThrow();
    expect(() => evaluate("1/0")).toThrow();
    expect(() => evaluate("(1+2")).toThrow();
  });

  it("reads numbers the way answers write them", () => {
    expect(numbersIn("about 3.2e8 cells/mL")).toEqual([3.2e8]);
    expect(numbersIn("$3.2 \\times 10^{8}$ CFU/mL")[0]).toBeCloseTo(3.2e8);
    expect(numbersIn("n = 6 generations, g = 20 min")).toEqual([6, 20]);
    expect(numbersIn("120,000 cells")).toEqual([120000]);
    expect(numbersIn("10^-3 dilution")[0]).toBeCloseTo(1e-3);
    expect(numbersIn("log2 of CO2")).toEqual([]);
  });

  it("grades a typed answer within 2%", () => {
    expect(parseAnswer("3.2 x 10^8")).toBeCloseTo(3.2e8);
    expect(parseAnswer("3.2e8 cells/mL")).toBeCloseTo(3.2e8);
    expect(parseAnswer("1/4")).toBe(0.25);
    expect(parseAnswer("1,000")).toBe(1000);
    expect(parseAnswer("no idea")).toBeNull();
    expect(matches(6.6, 6.64)).toBe(true);
    expect(matches(7, 6.64)).toBe(false);
    expect(matches(0, 0)).toBe(true);
    // Tiny targets stay relative: a tenfold-off [H+] isn't right.
    expect(matches(1e-12, 1e-13)).toBe(false);
    expect(matches(0, 1e-13)).toBe(false);
    expect(matches(1.01e-13, 1e-13)).toBe(true);
    expect(parseAnswer("6.02×10²³")).toBeCloseTo(6.02e23, -20);
    expect(numbersIn("Kw = 1.0 × 10⁻¹⁴")[0]).toBeCloseTo(1e-14, 20);
  });

  it("formats answers to three significant figures", () => {
    expect(formatNumber(6)).toBe("6");
    expect(formatNumber(6.6438)).toBe("6.64");
    expect(formatNumber(3.2e8)).toBe("$3.20 \\times 10^{8}$");
    expect(formatNumber(0.00012)).toBe("$1.20 \\times 10^{-4}$");
  });

  it("drops calculation questions whose own answer disagrees with their arithmetic", () => {
    const base = { options: [], answerIndex: -1, unit: "generations" };
    expect(checkCalculation({ ...base, type: "numeric", expression: "log2(3.2e8/5e6)", answer: "n = log2(64) = 6 generations." })).toMatchObject({
      ok: true,
      numeric: { value: 6, unit: "generations" },
    });
    expect(checkCalculation({ ...base, type: "numeric", expression: "log2(3.2e8/5e6)", answer: "That's 7 generations." }).ok).toBe(false);
    expect(checkCalculation({ ...base, type: "numeric", expression: "", answer: "6" }).ok).toBe(false);
    expect(checkCalculation({ ...base, type: "numeric", expression: "n of cells", answer: "6" }).ok).toBe(false);
    const mcq = { type: "mcq", expression: "60/3", answer: "20 min", options: ["10 min", "20 min", "30 min", "60 min"] };
    expect(checkCalculation({ ...mcq, answerIndex: 1 }).ok).toBe(true);
    expect(checkCalculation({ ...mcq, answerIndex: 2 }).ok).toBe(false);
    expect(checkCalculation({ ...mcq, options: ["20 min", "20.1 min", "30 min", "60 min"], answerIndex: 0 }).ok).toBe(false);
    // Not a calculation: left alone.
    expect(checkCalculation({ type: "mcq", answer: "", options: ["a", "b"], answerIndex: 0 })).toEqual({ ok: true });
  });
});

// ---------- Structure tokens ----------

describe("structure tokens", () => {
  it("finds, rewrites and flattens tokens", () => {
    const text = "Treat {{mol:C=CC|propene}} with HBr to get {{mol:CC(Br)C}}.";
    expect(molTokens(text)).toEqual([{ smiles: "C=CC", name: "propene" }, { smiles: "CC(Br)C", name: undefined }]);
    expect(hasMol(text)).toBe(true);
    expect(molsAsText(text)).toBe("Treat propene with HBr to get a structure.");
    expect(onlyMols("{{mol:CCO|ethanol}}")).toBe(true);
    expect(onlyMols("{{mol:CCO|ethanol}} and water")).toBe(false);
  });

  it("restores backslashes JSON escapes ate inside a token, and only there", () => {
    const eaten = "{{mol:F/C=C\nC1=CC=CC=C1|x}} line one\nline two";
    expect(repairMolTokens(eaten)).toBe("{{mol:F/C=C\\nC1=CC=CC=C1|x}} line one\nline two");
  });
});

describe("checking structures against their names", () => {
  // PubChem and OPSIN stand-ins: a few names, and "offline" to simulate no network.
  const known: Record<string, string> = {
    propene: "C=CC",
    "2-bromopropane": "CC(C)Br",
    "(r)-2-bromobutane": "CC[C@@H](C)Br",
    "trans-2-butene": "C/C=C/C",
    "sodium ethoxide": "CC[O-].[Na+]",
    "sodium hydroxide": "[OH-].[Na+]",
    "trans-1,2-dibromocyclohexane": "C1CC[C@H]([C@@H](C1)Br)Br",
    "(1r,2r)-1,2-dibromocyclohexane": "C1CC[C@H]([C@@H](C1)Br)Br",
    "garbage": "not json",
  };
  let offline = false;
  let calls = 0;
  beforeEach(async () => {
    await db.molecules.clear();
    offline = false;
    calls = 0;
    configureChem({
      fetch: async (url, init) => {
        calls++;
        if (offline) throw new TypeError("Failed to fetch");
        const name = url.includes("pubchem")
          ? decodeURIComponent(String(init?.body).replace(/^name=/, ""))
          : decodeURIComponent(url.split("/ws/")[1].replace(/\.json$/, ""));
        const smiles = known[name.toLowerCase()];
        if (!smiles) return new Response("{}", { status: 404 });
        if (smiles === "not json") return new Response("<html>Sign in to the Wi-Fi</html>", { status: 200 });
        return url.includes("pubchem")
          ? Response.json({ PropertyTable: { Properties: [{ SMILES: smiles }] } })
          : Response.json({ status: "SUCCESS", smiles });
      },
    });
  });

  it("passes a match, catches a wrong structure, and fills in missing stereochemistry", async () => {
    const R = await rdkit();
    expect(await verifyMol(R, { smiles: "CC=C", name: "propene" })).toEqual({ status: "ok" });
    expect(await verifyMol(R, { smiles: "CCCBr", name: "2-bromopropane" })).toMatchObject({ status: "mismatch" });
    expect(await verifyMol(R, { smiles: "CCC(C)Br", name: "(R)-2-bromobutane" })).toEqual({ status: "fixed", smiles: "CC[C@@H](C)Br" });
    expect(await verifyMol(R, { smiles: "CC[C@H](C)Br", name: "(R)-2-bromobutane" })).toMatchObject({ status: "mismatch" });
    expect(await verifyMol(R, { smiles: "C/C=C\\C", name: "trans-2-butene" })).toMatchObject({ status: "mismatch" });
    // A counter-ion doesn't make it a different compound.
    expect(await verifyMol(R, { smiles: "CC[O-]", name: "sodium ethoxide" })).toEqual({ status: "ok" });
  });

  it("takes either mirror image for cis/trans without R/S, salts in any order, and survives a bad response", async () => {
    const R = await rdkit();
    const other = "C1CC[C@@H]([C@H](C1)Br)Br";
    expect(mirror("C1CC[C@H]([C@@H](C1)Br)Br")).toBe(other);
    expect(await verifyMol(R, { smiles: other, name: "trans-1,2-dibromocyclohexane" })).toEqual({ status: "ok" });
    expect(await verifyMol(R, { smiles: other, name: "(1R,2R)-1,2-dibromocyclohexane" })).toMatchObject({ status: "mismatch" });
    expect(await verifyMol(R, { smiles: "[Na+].[OH-]", name: "sodium hydroxide" })).toEqual({ status: "ok" });
    expect(await verifyMol(R, { smiles: "[Na+].[Cl-]", name: "sodium hydroxide" })).toMatchObject({ status: "mismatch" });
    expect([...(await checkTokens(["{{mol:CCO|garbage}}"])).values()]).toEqual([{ status: "unverified" }]);
  });

  it("can't verify unknown names or offline, and rejects what RDKit can't read", async () => {
    const R = await rdkit();
    expect(await verifyMol(R, { smiles: "CC(C)(C)[C+]", name: "neopentyl cation thing" })).toEqual({ status: "unverified" });
    expect(await verifyMol(R, { smiles: "C1CC(", name: undefined })).toEqual({ status: "invalid" });
    expect(await verifyMol(R, { smiles: "C1CC(", name: "propene" })).toEqual({ status: "fixed", smiles: "C=CC" });
    offline = true;
    expect(await verifyMol(R, { smiles: "CCO", name: "ethanol" })).toEqual({ status: "unverified" });
  });

  it("remembers names it looked up", async () => {
    const R = await rdkit();
    await verifyMol(R, { smiles: "C=CC", name: "propene" });
    const first = calls;
    await verifyMol(R, { smiles: "C=CC", name: "Propene" });
    expect(calls).toBe(first);
  });

  it("drops questions with a contradicting or duplicate structure and fixes the rest", async () => {
    const q = (prompt: string, options: string[]) => ({ prompt, options, answer: "", explanation: "", hint: "" });
    const good = q("Major product of {{mol:C=CC|propene}} + HBr?", ["{{mol:CC(C)Br|2-bromopropane}}", "{{mol:CCCBr}}", "{{mol:CC(C)O}}", "{{mol:CCC}}"]);
    const wrong = q("Which is 2-bromopropane?", ["{{mol:CCCBr|2-bromopropane}}", "{{mol:CC}}", "{{mol:CCO}}", "{{mol:CCN}}"]);
    const dupes = q("Pick one", ["{{mol:OCC}}", "{{mol:CCO}}", "{{mol:CC}}", "{{mol:C}}"]);
    const stereo = q("Draw {{mol:CCC(C)Br|(R)-2-bromobutane}}", []);
    const plain = q("No structures here", ["a", "b"]);
    const { kept, dropped } = await checkQuestions([good, wrong, dupes, stereo, plain]);
    expect(dropped.map((d) => d.why)).toEqual(["mismatch: {{mol:CCCBr|2-bromopropane}}", "two options are the same molecule"]);
    expect(kept.map((k) => k.prompt)).toEqual([good.prompt, "Draw {{mol:CC[C@@H](C)Br|(R)-2-bromobutane}}", plain.prompt]);
  });

  it("corrects cards instead of dropping them", async () => {
    const cards = [
      { front: "2-bromopropane", back: "{{mol:CCCBr|2-bromopropane}}" },
      { front: "Broken", back: "{{mol:C1CC(}}" },
    ];
    const out = await checkItems(cards, (c) => [c.front, c.back], (c, fix) => ({ ...c, back: fix(c.back) }));
    expect(out).toEqual([{ front: "2-bromopropane", back: "{{mol:CC(C)Br|2-bromopropane}}" }]);
  });

  it("knows a stereodescriptor when it sees one", () => {
    for (const n of ["(R)-2-bromobutane", "(2R,3S)-2,3-dibromobutane", "(E)-but-2-ene", "cis-2-butene", "L-alanine", "α-D-glucose"]) expect(nameHasStereo(n)).toBe(true);
    for (const n of ["2-bromobutane", "propene", "Dimethyl ether", "alanine", "chloroform (CHCl3)"]) expect(nameHasStereo(n)).toBe(false);
  });
});

// ---------- Slides and diagrams ----------

describe("slides", () => {
  it("splits a source's text into pages", () => {
    const pages = pageTexts({ kind: "pdf", text: "<!-- page 1 -->\nTitle slide\n\n<!-- page 2 -->\nPsychrophiles grow at 0 C" });
    expect(pages.get(1)).toContain("Title slide");
    expect(pages.get(2)).toContain("Psychrophiles");
    expect(pageTexts({ kind: "image", text: "a photo" }).get(1)).toBe("a photo");
  });

  it("finds the slide a question comes from, or none", () => {
    const pages = [
      { id: "a:1", words: words("Cardinal temperatures: minimum, optimum and maximum growth temperature of microbes") },
      { id: "a:2", words: words("Psychrophiles have unsaturated fatty acids in their membranes and flexible enzymes") },
      { id: "a:3", words: words("Thermophiles have saturated lipids and more stable proteins with ionic bonds") },
    ];
    expect(bestPage("Why do psychrophiles keep their membranes fluid? Unsaturated fatty acids.", pages)).toBe("a:2");
    expect(bestPage("Which temperature is the optimum growth temperature for microbes?", pages)).toBe("a:1");
    expect(bestPage("What does DNA polymerase do?", pages)).toBeUndefined();
  });
});

describe("diagram labels", () => {
  it("converts Gemini's boxes and keeps only labels worth hiding", () => {
    toFraction([100, 200, 300, 600])!.forEach((v, i) => expect(v).toBeCloseTo([0.2, 0.1, 0.4, 0.2][i]));
    expect(toFraction([300, 200, 100, 600])).toBeNull();
    const diagram: [number, number, number, number] = [0, 0, 0.5, 0.5];
    const labels = usableLabels(diagram, [
      { text: "Outer membrane", box: [100, 100, 130, 250] },
      { text: "outer membrane", box: [200, 100, 230, 250] }, // duplicate
      { text: "Peptidoglycan", box: [150, 300, 180, 450] },
      { text: "Figure 5.3 shows the envelope of a Gram-negative bacterium in cross section", box: [10, 10, 40, 400] }, // a caption
      { text: "Far away", box: [800, 800, 830, 900] }, // outside the diagram
      { text: "Huge", box: [0, 0, 480, 480] }, // would cover the drawing
    ]);
    expect(labels.map((l) => l.text)).toEqual(["Outer membrane", "Peptidoglycan"]);
    expect(labels[0].box[0]).toBeCloseTo(0.2);
    expect(labels[0].box[1]).toBeCloseTo(0.2);
    padded([0, 0.5, 0.5, 0.5]).forEach((v, i) => expect(v).toBeCloseTo([0, 0.48, 0.52, 0.52][i]));
  });

  it("keeps labels that name parts, from a real autoclave and micrograph slide", () => {
    for (const t of ["Exhaust valve (to remove steam after sterilization)", "Perforated shelf", "Air", "Steam jacket"]) expect(namesAPart(t, "Steam autoclave diagram")).toBe(true);
    for (const t of ["A.", "(b)", "100%", "1.25 µg/ml", "10 µg/ml", "D100", "10 µm"]) expect(namesAPart(t)).toBe(false);
    expect(namesAPart("Steam autoclave", "Steam autoclave")).toBe(false);
    const [l] = usableLabels([0, 0, 1, 1], [{ text: "Flask of\nsample", box: [100, 100, 150, 300] }]);
    expect(l.text).toBe("Flask of sample");
  });

  it("tags a diagram with a concept only when they share words", () => {
    const concepts = [
      { name: "Moist vs. Dry Heat and Autoclaving", summary: "Steam under pressure kills endospores." },
      { name: "Filtration", summary: "Membrane filters remove microbes from liquids and air." },
    ];
    expect(conceptFor("Steam autoclave diagram Exhaust valve Steam jacket", concepts)).toBe("Moist vs. Dry Heat and Autoclaving");
    expect(conceptFor("Vacuum membrane filtration procedure Membrane filter", concepts)).toBe("Filtration");
    expect(conceptFor("Prokaryotic cell Ribosome Nucleoid", concepts)).toBeUndefined();
  });
});
