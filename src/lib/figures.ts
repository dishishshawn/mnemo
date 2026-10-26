// Diagram cards (image occlusion). Gemini looks at the slide images kept on this device (pages.ts),
// finds the labelled diagrams and where each label sits; the diagram is cut out and every label
// becomes a card that hides it, the way anatomy students make them in Anki by hand.

import { db, newId, type Figure, type Flashcard, type PageImage } from "./db";
import { blobToBase64 } from "./extract";
import { GeminiError, generateJson } from "./gemini";
import { jpegOf, pageTexts, words } from "./pages";
import { FIGURE_PROMPT, figureSchema, type FigureResult } from "./prompts";
import { newCard } from "./srs";

/** The concept that shares the most words with the diagram, or none if nothing does. */
export function conceptFor(text: string, concepts: { name: string; summary: string }[]): string | undefined {
  const mine = words(text);
  let best: { name: string; shared: number } | undefined;
  for (const c of concepts) {
    const shared = [...words(`${c.name} ${c.summary}`)].filter((w) => mine.has(w)).length;
    if (shared > (best?.shared ?? 0)) best = { name: c.name, shared };
  }
  return best?.name;
}

/** A diagram needs this many usable labels to be worth cards. */
const MIN_LABELS = 3;
/** New diagrams start this many a day, so one run on a long lecture doesn't land hundreds of cards due at once. */
export const DIAGRAMS_PER_DAY = 4;

/**
 * The same figure on two slides (a recap, or a build-up slide) shouldn't make two sets of cards:
 * mostly the same labels means the same diagram.
 */
export function sameDiagram(a: string[], b: string[]): boolean {
  const x = new Set(a.map((t) => t.toLowerCase()));
  const y = new Set(b.map((t) => t.toLowerCase()));
  const shared = [...x].filter((t) => y.has(t)).length;
  return shared / Math.min(x.size, y.size) >= 0.7;
}
/** Pages looked at per run; each is one Gemini call. */
export const PAGES_PER_RUN = 30;

type Box = [number, number, number, number];

/** Gemini's [ymin, xmin, ymax, xmax] on a 0–1000 scale, as [x, y, width, height] fractions. Null if it isn't a box. */
export function toFraction(box: number[]): Box | null {
  if (box.length !== 4 || box.some((v) => !Number.isFinite(v))) return null;
  const [y0, x0, y1, x1] = box.map((v) => Math.min(1000, Math.max(0, v)) / 1000);
  if (x1 <= x0 || y1 <= y0) return null;
  return [x0, y0, x1 - x0, y1 - y0];
}

/**
 * A label that names a part. Not a panel letter ("A.", "(b)"), a bare value or scale ("100%",
 * "1.25 µg/ml", "10 µm"), a caption, or the diagram's own title.
 */
export function namesAPart(text: string, title = ""): boolean {
  if (text.length > 60 || text.split(" ").length > 8) return false;
  // A step written as a sentence ("Genome is uncoated.") or numbered ("2. kick out OR") is a caption, not a part.
  if (/\.$/.test(text) && text.split(" ").length >= 3) return false;
  if (/^\d+[.)]\s/.test(text)) return false;
  if (!/\p{L}{3,}/u.test(text.replace(/\b(?:[mµnk]?[gml]|[mµn]m|ml|mg|µg|ng|min|sec|hr|°C)\b/gi, ""))) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return !title || norm(text) !== norm(title);
}

/**
 * The labels worth hiding, in the diagram's own coordinates: inside it, naming a part (namesAPart),
 * not so big they'd cover the drawing, and each text once.
 */
export function usableLabels(diagram: Box, labels: { text: string; box: number[] }[], title = ""): Figure["labels"] {
  const [dx, dy, dw, dh] = diagram;
  const seen = new Set<string>();
  const out: Figure["labels"] = [];
  for (const l of labels) {
    // Labels set over several lines come back with line breaks.
    const text = l.text.replace(/\s+/g, " ").trim();
    const b = toFraction(l.box);
    if (!b || !text || !namesAPart(text, title)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    const cx = b[0] + b[2] / 2;
    const cy = b[1] + b[3] / 2;
    if (cx < dx || cx > dx + dw || cy < dy || cy > dy + dh) continue;
    // Relative to the diagram, clipped to it.
    const x = Math.max(0, (b[0] - dx) / dw);
    const y = Math.max(0, (b[1] - dy) / dh);
    const w = Math.min(1 - x, b[2] / dw);
    const h = Math.min(1 - y, b[3] / dh);
    if (w * h > 0.2) continue;
    seen.add(key);
    out.push({ text, box: [x, y, w, h] });
  }
  return out;
}

/** The diagram plus a little margin, so labels at its edge aren't cut. */
export function padded([x, y, w, h]: Box, pad = 0.02): Box {
  const x0 = Math.max(0, x - pad);
  const y0 = Math.max(0, y - pad);
  return [x0, y0, Math.min(1, x + w + pad) - x0, Math.min(1, y + h + pad) - y0];
}

async function crop(page: PageImage, [x, y, w, h]: Box): Promise<{ image: ArrayBuffer; width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([page.image], { type: "image/jpeg" }));
  const sx = Math.round(x * bitmap.width);
  const sy = Math.round(y * bitmap.height);
  const sw = Math.max(1, Math.round(w * bitmap.width));
  const sh = Math.max(1, Math.round(h * bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();
  const image = await jpegOf(canvas);
  canvas.width = canvas.height = 0;
  return { image, width: sw, height: sh };
}

/**
 * Pages worth a look: not looked at before, and, when Gemini read the PDF, only pages it described
 * a figure on. Pages read locally have no figure descriptions, so all of them count.
 */
export async function candidatePages(kitId: string): Promise<string[]> {
  const ids = (await db.pages.where("kitId").equals(kitId).filter((p) => !p.scanned).primaryKeys()) as string[];
  const sources = new Map((await db.sources.where("kitId").equals(kitId).toArray()).map((s) => [s.id, s]));
  const texts = new Map<string, Map<number, string>>();
  return ids
    .filter((id) => {
      const cut = id.lastIndexOf(":");
      const source = sources.get(id.slice(0, cut));
      if (!source) return false;
      if (source.via === "local") return true;
      if (!texts.has(source.id)) texts.set(source.id, pageTexts(source));
      const text = texts.get(source.id)!.get(Number(id.slice(cut + 1)));
      return text === undefined || /Figure:/i.test(text);
    })
    .sort((a, b) => {
      const [sa, pa] = [a.slice(0, a.lastIndexOf(":")), Number(a.slice(a.lastIndexOf(":") + 1))];
      const [sb, pb] = [b.slice(0, b.lastIndexOf(":")), Number(b.slice(b.lastIndexOf(":") + 1))];
      return (sources.get(sa)?.createdAt ?? 0) - (sources.get(sb)?.createdAt ?? 0) || pa - pb;
    });
}

export interface DiagramRun {
  pages: number;
  figures: number;
  cards: number;
  /** Pages still waiting for a run. */
  left: number;
  /** Over how many days the new diagrams start (DIAGRAMS_PER_DAY). */
  days: number;
}

/** Looks at up to PAGES_PER_RUN pages and turns every labelled diagram on them into cards. */
export async function makeDiagramCards(
  kitId: string,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<DiagramRun> {
  const all = await candidatePages(kitId);
  // Pages that weren't worth a look are marked so they aren't counted again.
  const skipped = (await db.pages.where("kitId").equals(kitId).filter((p) => !p.scanned).primaryKeys()).filter((id) => !all.includes(id as string));
  if (skipped.length) await db.pages.where("id").anyOf(skipped).modify({ scanned: true });
  const batch = all.slice(0, PAGES_PER_RUN);
  const concepts = await db.concepts.where("kitId").equals(kitId).toArray();
  const known = (await db.figures.where("kitId").equals(kitId).toArray()).map((f) => f.labels.map((l) => l.text));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let done = 0;
  let figures = 0;
  let cards = 0;
  opts.onProgress?.(0, batch.length);

  // Quota and capacity errors stop the run and leave the page for next time; anything else about a
  // page (blocked, unreadable, won't crop) won't change on a retry, so the page is skipped.
  const retryable = (err: unknown) => (err instanceof GeminiError && ["quota", "busy", "no-key", "bad-key"].includes(err.code)) || opts.signal?.aborted;

  const one = async (id: string) => {
    // Claimed up front, so a run started while this one is still finishing doesn't do the page twice.
    await db.pages.update(id, { scanned: true });
    try {
      await scan(id);
    } catch (err) {
      if (retryable(err)) {
        await db.pages.update(id, { scanned: false });
        throw err;
      }
      console.warn("Skipped a page for diagram cards", id, err);
    }
  };

  const scan = async (id: string) => {
    const page = await db.pages.get(id);
    if (!page) return;
    const res = await generateJson<FigureResult>({
      role: "smart",
      task: "diagram-cards",
      kitId,
      signal: opts.signal,
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: "image/jpeg", data: await blobToBase64(new Blob([page.image])) } }, { text: FIGURE_PROMPT }],
        },
      ],
      schema: figureSchema,
    });
    for (const d of res.diagrams ?? []) {
      const area = toFraction(d.box ?? []);
      if (!area) continue;
      const region = padded(area);
      const title = d.title?.trim() || "Diagram";
      const labels = usableLabels(region, d.labels ?? [], title);
      if (labels.length < MIN_LABELS) continue;
      const texts = labels.map((l) => l.text);
      if (known.some((k) => sameDiagram(k, texts))) continue;
      known.push(texts);
      // Counted before the awaits, so diagrams found at the same time still get their own day.
      const day = Math.floor(figures++ / DIAGRAMS_PER_DAY);
      const { image, width, height } = await crop(page, region);
      const due = day ? new Date(today.getTime() + day * 86_400_000) : new Date();
      const figure: Figure = { id: newId(), kitId, sourceId: page.sourceId, page: page.page, title, image, width, height, labels, createdAt: Date.now() };
      const concept = conceptFor(`${title} ${labels.map((l) => l.text).join(" ")}`, concepts);
      const deck: Flashcard[] = labels.map((l, label) => ({
        id: newId(),
        kitId,
        front: title,
        back: l.text,
        kind: "term",
        concept,
        figure: { id: figure.id, label },
        srs: newCard(due),
        createdAt: Date.now(),
      }));
      if (!(await db.kits.get(kitId))) return;
      await db.transaction("rw", db.figures, db.flashcards, async () => {
        await db.figures.add(figure);
        await db.flashcards.bulkAdd(deck);
      });
      cards += deck.length;
    }
  };

  // Three at a time: quick, and gentle on free-tier rate limits. The first failure stops them all.
  const queue = [...batch];
  let failed = false;
  const worker = async () => {
    for (let id = queue.shift(); id && !failed; id = queue.shift()) {
      if (opts.signal?.aborted) return;
      try {
        await one(id);
      } catch (err) {
        failed = true;
        throw err;
      }
      opts.onProgress?.(++done, batch.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { pages: batch.length, figures, cards, left: all.length - batch.length, days: Math.ceil(figures / DIAGRAMS_PER_DAY) };
}
