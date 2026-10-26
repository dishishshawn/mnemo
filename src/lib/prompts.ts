// Every generation call is laid out as [SYSTEM][<material>…</material>][task]. Keeping the system
// instruction constant and the material first means repeat calls on the same kit share a long
// prefix, which Gemini's implicit cache bills at 10% of the input price.

import type { Content } from "@google/genai";
import { drawsStructures, SUBJECTS, type Subject } from "./subject";

export const SYSTEM = `You are Mnemo, an expert teacher and study coach.
You build study material strictly from the student's course material, given inside <material> tags.
- Stay faithful to the material. Do not introduce facts it does not support, except standard background knowledge that is needed to make sense of it.
- Prefer understanding over trivia: ask about ideas, mechanisms, relationships and applications, not page numbers or incidental wording.
- Write clearly for a university student. Use Markdown. Use LaTeX with $...$ or $$...$$ for math and chemistry, with only standard commands that KaTeX supports (a triple bond is \\equiv).
- Follow the language instruction in each task exactly.`;

export function languageLine(language: string): string {
  return language === "auto"
    ? "Write everything in the same language as the material (if mixed, use the dominant one)."
    : `Write everything in ${language}, even if the material is in another language.`;
}

/** Builds the contents array: material first (cacheable), task last. */
export function withMaterial(material: string, task: string): Content[] {
  return [
    {
      role: "user",
      parts: [{ text: `<material>\n${material}\n</material>` }, { text: task }],
    },
  ];
}

/** When the material is already in an explicit cache, only the task is sent. */
export function taskOnly(task: string): Content[] {
  return [{ role: "user", parts: [{ text: task }] }];
}

// ---------- Kit analysis ----------

const subjectProperties = {
  subject: {
    type: "string",
    enum: SUBJECTS.map((s) => s.value),
    description: "The field the material belongs to. Microbiology, genetics, physiology and ecology are biology.",
  },
  quantitative: {
    type: "boolean",
    description: "True if the material teaches calculations a student must be able to do (formulas worked with numbers).",
  },
};

export const analyzeSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short kit title, max 60 characters" },
    description: { type: "string", description: "One or two sentences describing what the material covers" },
    emoji: { type: "string", description: "A single emoji that fits the subject" },
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Concept name, max 6 words" },
          summary: { type: "string", description: "One sentence on what the student must understand" },
          chunks: {
            type: "array",
            items: { type: "integer" },
            description: "Numbers of every <!-- chunk N --> section that teaches this concept",
          },
        },
        required: ["name", "summary", "chunks"],
      },
    },
    ...subjectProperties,
  },
  required: ["title", "description", "emoji", "concepts", "subject", "quantitative"],
};

export interface AnalyzeResult {
  title: string;
  description: string;
  emoji: string;
  concepts: { name: string; summary: string; chunks?: number[] }[];
  subject?: Subject;
  quantitative?: boolean;
}

// ---------- Subjects ----------

/** For kits mapped before subjects existed: a cheap call on the kit's outline, no material. */
export const subjectSchema = { type: "object", properties: subjectProperties, required: ["subject", "quantitative"] };

export function subjectTask(kit: { title: string; description: string }, concepts: { name: string; summary: string }[]): string {
  return `A study kit is titled "${kit.title}": ${kit.description}
Its concepts:
${concepts.map((c) => `- ${c.name}: ${c.summary}`).join("\n")}

Which field is it, and does it teach calculations?`;
}

/** How to write a molecule so the app can draw and check it (chem.ts, mol.ts). */
export const MOL_RULE = `Chemical structures: wherever a specific molecule's structure matters (in a question, an option, an answer or an explanation), draw it with a structure token {{mol:SMILES|name}} instead of describing it in words. SMILES must be valid and include stereochemistry (@, @@, /, \\) whenever it matters. "name" is the compound's IUPAC or common name, only for a specific real compound; for intermediates, carbocations, generic or partial structures, leave it out: {{mol:SMILES}}. Write an R group as *. A token stands on its own: never inside $...$, backticks or bold. Write reactions and formulas with mhchem, e.g. $\\ce{CH3CH2OH ->[H2SO4][\\Delta] CH2=CH2 + H2O}$.`;

const BIO_NOTATION = "Italicise genus and species names (*Escherichia coli*, then *E. coli*) and gene names (*lacZ*); protein names stay upright (LacZ).";

const QUESTION_STYLES: Partial<Record<Subject, string>> = {
  "organic-chemistry": `Question styles for organic chemistry (use the ones the material supports):
- predict the major product of a reaction
- the reagents or conditions that carry out a transformation
- the next intermediate in a mechanism, or its rate-determining step
- regiochemistry (Markovnikov or anti-Markovnikov) and stereochemistry (syn or anti addition, inversion or racemisation, R/S, E/Z)
- rank acidity, basicity, carbocation or radical stability, nucleophilicity or leaving-group ability
- SN1, SN2, E1 or E2 for a given substrate, nucleophile and solvent
- spectroscopy: key IR bands, the number of 1H NMR signals and their splitting
- a short synthesis: the sequence of reagents from one structure to another.
For multiple choice about structures, make each option a single structure token, and make the wrong ones the structures a student gets from a typical mistake: the other regiochemistry, the wrong stereochemistry, a missed carbocation rearrangement, the wrong functional group.`,
  biochemistry: `Question styles for biochemistry (use the ones the material supports): the structures of amino acids, sugars, nucleotides and lipids; where a pathway step happens, its substrates, products, enzyme and regulation; enzyme kinetics and inhibition; how a structural feature produces a function; the effect of a mutation, an inhibitor or a missing cofactor.`,
  biology: `Question styles for biology (use the ones the material supports): the steps of a process in order and what triggers each; how a structure's features produce its function; what happens when a gene is knocked out, a condition changes or a step is blocked; what an experiment or data set (growth curves, tables, gels, pedigrees) shows and why; telling similar terms apart and applying them to a new organism or example.`,
  chemistry: `Question styles for chemistry (use the ones the material supports): stoichiometry, equilibrium, acids and bases, thermodynamics and kinetics, applied to a new example. Write every equation with mhchem.`,
};

/** Notation the subject needs in anything written about it: structure tokens for chemistry, italics for biology. */
export function notationFor(subject?: Subject): string {
  const lines: string[] = [];
  if (drawsStructures(subject)) lines.push(MOL_RULE);
  if (subject === "biology" || subject === "biochemistry") lines.push(BIO_NOTATION);
  return lines.join("\n");
}

/** Question styles and notation for the kit's subject, for question-writing tasks. */
export function questionGuidance(subject?: Subject): string {
  return [subject ? QUESTION_STYLES[subject] : undefined, notationFor(subject)].filter(Boolean).join("\n");
}

export function analyzeTask(language: string): string {
  return `Task: map this material for study.
Identify the key concepts a student must master, in the order the material presents them. Use between 5 and 30 concepts depending on how much material there is; merge minor points into broader concepts rather than listing every fact.
The material is divided into numbered sections marked <!-- chunk N -->. For each concept, list every chunk number that teaches it (definitions, explanations, figures, examples). A chunk may belong to several concepts.
${languageLine(language)}`;
}

// ---------- Flashcards ----------

export const flashcardSchema = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["term", "qa"] },
          front: { type: "string" },
          back: { type: "string" },
          concept: { type: "string", description: "Name of the concept this card belongs to" },
        },
        required: ["kind", "front", "back", "concept"],
      },
    },
  },
  required: ["cards"],
};

export interface FlashcardResult {
  cards: { kind: "term" | "qa"; front: string; back: string; concept: string }[];
}

export function flashcardTask(opts: {
  language: string;
  count: number;
  concepts: string[];
  existingFronts: string[];
  focus?: string;
  /** Subject notation (notationFor). */
  notation?: string;
}): string {
  return `Task: write ${opts.count} flashcards.
- About 60% "term" cards: front is a key term or name (1 to 4 words, no question mark); back is a precise definition in at most 25 words.
- The rest "qa" cards: front is a focused question that tests understanding; back is the answer in at most 40 words.
- Spread cards across these concepts: ${opts.concepts.join("; ")}.
- Each card tests exactly one idea. Do not repeat these existing fronts: ${opts.existingFronts.length ? opts.existingFronts.slice(0, 200).join(" | ") : "(none)"}.
${opts.focus ? `- The student asked to focus on: ${opts.focus}\n` : ""}${opts.notation ? `${opts.notation}\n` : ""}${languageLine(opts.language)}`;
}

// ---------- Questions (Smart Study and practice tests) ----------

export type QuestionKind = "mcq" | "tf" | "short" | "numeric";

export const questionSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          concept: { type: "string" },
          type: { type: "string", enum: ["mcq", "tf", "short", "numeric"] },
          difficulty: { type: "integer", minimum: 1, maximum: 3, description: "1, 2 or 3" },
          prompt: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
            description: "mcq: exactly 4 options. tf: [\"True\", \"False\"]. short and numeric: empty array.",
          },
          answerIndex: { type: "integer", description: "Index of the correct option; -1 for short answer and numeric" },
          answer: { type: "string", description: "The model answer, 1 to 3 sentences" },
          explanation: { type: "string", description: "Why the answer is right and the tempting wrong answers are wrong" },
          hint: { type: "string", description: "A Socratic nudge that points toward the idea without giving the answer away" },
          expression: { type: "string", description: "Calculation questions only: the arithmetic that gives the answer. Otherwise empty." },
          unit: { type: "string", description: "numeric only: the answer's unit, or empty if it has none" },
        },
        required: ["concept", "type", "difficulty", "prompt", "options", "answerIndex", "answer", "explanation", "hint"],
      },
    },
  },
  required: ["questions"],
};

export interface QuestionResult {
  questions: {
    concept: string;
    type: QuestionKind;
    difficulty: number;
    prompt: string;
    options: string[];
    answerIndex: number;
    answer: string;
    explanation: string;
    hint: string;
    expression?: string;
    unit?: string;
  }[];
}

/** The rule for calculation questions, whose answers the app works out itself (calc.ts). */
export const NUMERIC_RULE = `- numeric: a calculation from the material with a single number as the answer, needing at least one arithmetic step (never a number the material simply states; that's multiple choice). The prompt gives every number needed. "expression" is the arithmetic that computes the answer from those numbers, written with numbers only (no names or units), + - * / ^ and parentheses, and the functions ln, log (base 10), log2, exp and sqrt, e.g. "log2(3.2e8/5e6)". "unit" is the answer's unit. "answer" shows the working and ends with the result.
- A multiple-choice question whose answer is a calculated number also gets an "expression", and its correct option shows that number.`;

export interface QuestionTarget {
  name: string;
  /** 0..1 */
  mastery: number;
  attempts: number;
  /** Smart Study: the difficulty to write this concept's questions at (smart.ts targetDifficulty). */
  difficulty?: 1 | 2 | 3;
}

export function questionTask(opts: {
  language: string;
  count: number;
  targets: QuestionTarget[];
  types: QuestionKind[];
  avoid: string[];
  steer?: string;
  purpose: "smart" | "test";
  /** Earlier questions the student reported as wrong, and why. */
  reported?: { prompt: string; reason: string }[];
  /** Subject-specific question styles and notation (subject.ts). */
  guidance?: string;
}): string {
  const perConcept = opts.purpose === "smart" && opts.targets.every((t) => t.difficulty);
  const targets = opts.targets
    .map((t) => {
      const level = t.attempts === 0 ? "new" : t.mastery < 0.4 ? "weak" : t.mastery < 0.75 ? "developing" : "strong";
      return perConcept ? `- ${t.name} (${level}): difficulty ${t.difficulty}` : `- ${t.name} (${level})`;
    })
    .join("\n");
  return `Task: write ${opts.count} ${opts.purpose === "test" ? "exam-style practice test" : "adaptive practice"} questions.
Target concepts and the student's current level:
${targets}

Difficulty:
1 = recall: a fact, term or definition the material states directly, asked plainly. Wrong options are clearly different from the answer, so a student who has read the material gets it right.
2 = understand and apply: explain why, connect two ideas, or apply an idea to a familiar example. Wrong options are plausible.
3 = analyse: compare, predict an outcome, interpret data, or solve a multi-step problem. Wrong options are common misconceptions.
${
  opts.purpose === "test"
    ? "Cover every target concept at least once, with a realistic exam mix of difficulties (roughly 30% level 1, 50% level 2, 20% level 3)."
    : perConcept
      ? "Write each concept's questions at the difficulty listed for it. Put more questions on weak and new concepts."
      : "Match difficulty to level: new -> mostly 1, weak -> 1 or 2, developing -> 2, strong -> 3. Put more questions on weak and new concepts."
}
Allowed types: ${opts.types.join(", ")}. Use a mix if more than one is allowed.
- mcq: exactly 4 options, one clearly correct; wrong options similar in length and style to the answer, and as close to it as the difficulty calls for. Never use "all of the above" or "none of the above".
- tf: a precise statement, written as a plain statement (never prefixed with "True or False:"); avoid trick wording and absolute words used only to make it false.
- short: answerable in 1 to 3 sentences; the model answer lists the essential points a grader should look for.
${opts.types.includes("numeric") ? `${NUMERIC_RULE}\n` : ""}- The hint must never reveal the answer; ask a guiding question or point at the relevant idea.
${opts.guidance ? `${opts.guidance}\n` : ""}${opts.avoid.length ? `Do not repeat or closely paraphrase these earlier questions:\n${opts.avoid.slice(-60).map((q) => `- ${q}`).join("\n")}\n` : ""}${
    opts.reported?.length
      ? `The student reported these earlier questions as wrong. Don't repeat them or make the same kind of mistake:\n${opts.reported
          .slice(-10)
          .map((r) => `- "${r.prompt}" (${r.reason})`)
          .join("\n")}\n`
      : ""
  }${opts.steer ? `The student asked: "${opts.steer}". Follow that where the material allows.\n` : ""}${languageLine(opts.language)}`;
}

// ---------- Grading free-text answers (fast model, no material: cheap) ----------

export const gradeSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["correct", "partial", "incorrect"] },
          score: { type: "number", description: "0 to 1" },
          feedback: { type: "string" },
        },
        required: ["id", "verdict", "score", "feedback"],
      },
    },
  },
  required: ["results"],
};

export interface GradeResult {
  results: { id: string; verdict: "correct" | "partial" | "incorrect"; score: number; feedback: string }[];
}

export const GRADER_SYSTEM = `You grade students' short answers against a model answer.
- Judge meaning, not wording. Accept synonyms, paraphrases, and minor spelling mistakes.
- "correct" (score 1): all essential points present and nothing wrong. "partial" (0.3 to 0.7): some essential points, or a minor error. "incorrect" (0 to 0.2): missing the core idea or contains a significant error.
- Feedback is at most 2 sentences, warm and specific.
- Follow the feedback style requested for each item.`;

export function gradeTask(
  language: string,
  items: { id: string; question: string; modelAnswer: string; studentAnswer: string; reveal: boolean }[],
): string {
  const body = items
    .map(
      (it) => `<item id="${it.id}">
Question: ${it.question}
Model answer: ${it.modelAnswer}
Student answer: ${it.studentAnswer || "(blank)"}
Feedback style: ${
        it.reveal
          ? "explain what was missing or wrong, then state the correct answer briefly."
          : "if not fully correct, do NOT reveal the answer; name what is missing or off and ask one guiding question so the student can try again."
      }
</item>`,
    )
    .join("\n");
  return `${body}\n\nGrade every item. ${languageLine(language)}`;
}

// ---------- Explain it back (teach-back): the student explains a concept aloud ----------

export const explainSchema = {
  type: "object",
  properties: {
    score: { type: "number", description: "0 to 1: how completely and correctly the concept was explained" },
    covered: { type: "array", items: { type: "string" }, description: "Essential points the student got right, each a short phrase" },
    missing: { type: "array", items: { type: "string" }, description: "Essential points the student left out, each a short phrase" },
    errors: { type: "array", items: { type: "string" }, description: "Things the student said that are wrong, each with the correction, one sentence" },
    tip: { type: "string", description: "One or two sentences: the single most useful thing to fix or add next time" },
  },
  required: ["score", "covered", "missing", "errors", "tip"],
};

export interface ExplainResult {
  score: number;
  covered: string[];
  missing: string[];
  errors: string[];
  tip: string;
}

export const EXPLAIN_SYSTEM = `You assess a student explaining a concept in their own words, as if teaching it to a friend, against the course material given inside <material> tags.
- The explanation was spoken and transcribed: ignore filler words, repetition, punctuation and transcription slips. Judge the ideas.
- First decide the 3 to 6 essential points the material makes about the concept. Then sort each into covered or missing. Only list a point as missing if the material actually teaches it.
- An error is a claim that contradicts the material. Vague or incomplete is not an error.
- Score: 1 = every essential point, nothing wrong. 0.7 = most points, nothing wrong. 0.4 = about half, or one error. 0.1 = the core idea is missing or wrong.
- Be warm and concrete. Phrases, not paragraphs.`;

export function explainTask(opts: { language: string; concept: string; summary: string; explanation: string }): string {
  return `The student was asked to explain "${opts.concept}" (${opts.summary}) from memory.

<explanation>
${opts.explanation}
</explanation>

Assess the explanation. ${languageLine(opts.language)}`;
}

// ---------- Long-form outputs ----------

export function guideTask(language: string, concepts: string[], notation = ""): string {
  return `Task: write a complete study guide for this material, in Markdown.
Structure:
1. "# <title>" and a 2-3 sentence overview.
2. One "##" section per major topic, following the material's order. In each: the key ideas explained clearly, **bold** key terms with definitions, a worked example or concrete application wherever possible, and a short "Common mistakes" note where relevant.
3. "## Key terms": a Markdown table (Term | Definition).
4. "## Memory aids": mnemonics or analogies for the hardest ideas.
5. "## Check yourself": 8 to 12 questions mixing recall and application, then "## Answer key" with brief answers.
Cover these concepts: ${concepts.join("; ")}.
Be thorough but tight: no filler, no repetition.${notation ? `\n${notation}` : ""}
${languageLine(language)}`;
}

export function summaryTask(language: string, notation = ""): string {
  return `Task: write a concise summary of this material, in Markdown.
Structure:
1. "## TL;DR": 3 to 5 bullets with the most important takeaways.
2. "## Key points": short sections by topic, each a few tight bullets.
3. "## Must-know terms": a bulleted list of term: one-line definition.
Aim for roughly one tenth the length of the material, at most 900 words.${notation ? `\n${notation}` : ""}
${languageLine(language)}`;
}

// ---------- Reaction sheet (organic chemistry) ----------

export const reactionSchema = {
  type: "object",
  properties: {
    reactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The reaction's name, e.g. \"Hydrobromination of an alkene\"" },
          concept: { type: "string", description: "The concept it belongs to" },
          substrate: { type: "string", description: "A structure token for a representative starting material" },
          reagents: { type: "string", description: "Reagents and conditions, with mhchem, e.g. \"$\\ce{HBr}$, peroxides\"" },
          product: { type: "string", description: "A structure token for that starting material's major product" },
          regiochemistry: { type: "string", description: "e.g. \"Markovnikov\"; empty if it doesn't apply" },
          stereochemistry: { type: "string", description: "e.g. \"anti addition\", \"inversion\", \"racemic\"; empty if it doesn't apply" },
          mechanism: { type: "string", description: "e.g. \"carbocation intermediate, rearrangements possible\", \"concerted\", \"radical chain\"" },
          notes: { type: "string", description: "One sentence: the catch students get wrong" },
        },
        required: ["name", "concept", "substrate", "reagents", "product", "regiochemistry", "stereochemistry", "mechanism", "notes"],
      },
    },
  },
  required: ["reactions"],
};

export interface ReactionSheet {
  reactions: {
    name: string;
    concept: string;
    substrate: string;
    reagents: string;
    product: string;
    regiochemistry: string;
    stereochemistry: string;
    mechanism: string;
    notes: string;
  }[];
}

export function reactionTask(language: string, concepts: string[]): string {
  return `Task: make a reaction sheet for revising this material: every reaction it teaches, in the order it presents them.
For each reaction: a representative starting material and its major product as structure tokens (use the material's own example when it has one; a general structure with * for R groups when the reaction is general), the reagents and conditions, the regiochemistry, the stereochemistry, the kind of mechanism, and the one catch students get wrong.
Skip reactions the material only mentions in passing. At most 40. Concepts: ${concepts.join("; ")}.
${MOL_RULE}
${languageLine(language)}`;
}

// ---------- Diagram cards: finding labels on a page image ----------

const box = (what: string) => ({ type: "array", items: { type: "integer" }, description: `${what}, as [ymin, xmin, ymax, xmax] scaled 0 to 1000` });

export const figureSchema = {
  type: "object",
  properties: {
    diagrams: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "What the diagram shows, in a few words" },
          box: box("The whole diagram, labels included"),
          labels: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "The label's text exactly as printed" },
                box: box("A tight box around the label's text itself, not the part it points to"),
              },
              required: ["text", "box"],
            },
          },
        },
        required: ["title", "box", "labels"],
      },
    },
  },
  required: ["diagrams"],
};

export interface FigureResult {
  diagrams: { title: string; box: number[]; labels: { text: string; box: number[] }[] }[];
}

export const FIGURE_PROMPT = `Find the labelled diagrams on this page: drawings, micrographs or schematics whose parts are named by text labels, often with leader lines. Ignore charts that only have axis labels, tables, and plain text.
For each diagram give a title, its bounding box, and every label that names a part of it: the label's exact text on one line and a tight box around that text.
Leave out panel letters (A, B, (c)), numbers and measurements on their own, scale bars, the diagram's title, credits, and sentences of explanation.
If there is no labelled diagram, return an empty list.`;

// ---------- Podcast ----------

export const podcastSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", enum: ["A", "B"] },
          text: { type: "string" },
        },
        required: ["speaker", "text"],
      },
    },
  },
  required: ["title", "lines"],
};

export interface PodcastScript {
  title: string;
  lines: { speaker: "A" | "B"; text: string }[];
}

/** Gemini TTS speaks ~150 words a minute; a line averages ~17 words. */
export const PODCAST_WPM = 150;

export function podcastTask(opts: { language: string; minutes: number; hostA: string; hostB: string; focus?: string }): string {
  const words = Math.round(opts.minutes * PODCAST_WPM);
  const lines = Math.max(8, Math.round(words / 17));
  return `Task: write a two-host study podcast script about this material for a ${opts.minutes}-minute episode.
LENGTH IS A HARD LIMIT: exactly ${lines} lines and at most ${words} words in total. Each line is 1 to 3 short sentences. Cover the most important ideas only; leave the rest out rather than running long.
- Host A (${opts.hostA}) is the expert who explains; Host B (${opts.hostB}) is a sharp fellow student who asks the questions a learner would ask, makes connections, and occasionally gets something slightly wrong so A can correct it.
- Open with a one-line hook, then walk through the key ideas in a logical order, using concrete examples and analogies. Keep it accurate to the material.
- Natural spoken language: short sentences, contractions, light humour. No stage directions, sound effects, Markdown, or LaTeX; say formulas in words.
- The last 6 lines are a 3-question rapid-fire recap where B asks and A answers.
${opts.focus ? `- Focus on: ${opts.focus}\n` : ""}${languageLine(opts.language)}`;
}

// ---------- Tutor ----------

export function tutorSystem(socratic: boolean, language: string, notation = ""): string {
  return `${SYSTEM}

${tutorInstructions(socratic, language, notation)}`;
}

export function tutorInstructions(socratic: boolean, language: string, notation = ""): string {
  return `You are now tutoring the student one-on-one about the material.
${
  socratic
    ? `Teach Socratically. Do not hand over answers to questions that look like homework or practice problems. Instead ask one guiding question at a time, check the student's reasoning, and give hints that get progressively more specific. When the student reaches the answer, confirm it and briefly consolidate. If the student is clearly stuck after several tries, or just wants a concept explained (not a problem solved), explain it clearly, then check understanding with a quick question.`
    : `Explain clearly and directly, with examples. After explaining, offer a quick question to check understanding.`
}
Keep replies short (under 150 words) unless the student asks for more. If a question is outside the material, say so briefly and help anyway with general knowledge, flagged as such.
${notation ? `${notation}\n` : ""}${languageLine(language)}`;
}

// ---------- Ingestion (fast model) ----------

/** Drawn molecules survive transcription as structure tokens, so questions can draw them again. */
const STRUCTURE_TRANSCRIPTION = `For each chemical structure drawn (skeletal or condensed formula), write it as a structure token {{mol:SMILES|name}} with stereochemistry where it is shown, followed by a one-line description; give a name only for a specific real compound.`;

export const TRANSCRIBE_PROMPTS: Record<string, string> = {
  document: `Convert this document to clean, complete Markdown so a student can study from the text alone.
Start each page with the marker <!-- page N --> on its own line, where N is the page number, counting from 1.
Keep every piece of content in its original order: headings, paragraphs, lists, tables (as Markdown tables), equations (LaTeX).
For each figure, chart, or diagram, add "> Figure: " followed by a description of what it shows and every label or value in it.
${STRUCTURE_TRANSCRIPTION}
Do not summarise or omit anything. Output only the Markdown.`,
  image: `Transcribe this image of study material to Markdown. Include all text exactly, including handwriting (mark unclear words with [?]).
Write equations in LaTeX. For diagrams, add "> Figure: " followed by what the diagram shows, including all labels.
${STRUCTURE_TRANSCRIPTION}
Output only the Markdown.`,
  audio: `Transcribe this lecture or study recording into clean Markdown notes a student can study from.
Remove filler words and false starts but keep all substantive content, examples, and anything the speaker says is important or will be on the exam.
Add "##" headings when the topic changes. Write equations in LaTeX. Output only the Markdown.`,
  video: `Turn this lecture video into clean, complete Markdown study notes.
Capture everything the speaker explains (remove filler), and everything shown on screen: slide text, board work, diagrams (described with all labels), equations (LaTeX), and code.
Add "##" headings when the topic changes, and note anything the speaker says is important or will be on the exam. Output only the Markdown.`,
  web: `Read the web page at the URL below and return its main educational content as clean Markdown.
Skip navigation, ads, comments, and other boilerplate. Keep headings, lists, tables, equations (LaTeX), and figure descriptions. Output only the Markdown.`,
};
