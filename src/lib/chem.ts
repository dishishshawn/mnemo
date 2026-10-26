// Chemical structures: drawing them with RDKit.js (WebAssembly, loaded the first time a structure
// shows up) and checking the ones Gemini writes. Before generated questions, cards or sheets are
// saved, every named structure is looked up by its name (OPSIN, then PubChem for names OPSIN can't
// parse) and compared with the structure Gemini drew. A name paired with the wrong structure means
// the item can't be trusted.

import type { MainModule } from "@rdkit/rdkit";
import { db } from "./db";
import { hasMol, molTokens, onlyMols, replaceMols, type MolToken } from "./mol";

// ---------- RDKit ----------

let loading: Promise<MainModule> | null = null;

export function rdkit(): Promise<MainModule> {
  loading ??= (async () => {
    const { default: init } = await import("@rdkit/rdkit");
    // In Node (tests, scripts) RDKit finds its .wasm next to its .js; in the browser Vite serves it.
    let R: MainModule;
    if (typeof window === "undefined") R = await init();
    else {
      const wasm = (await import("@rdkit/rdkit/RDKit_minimal.wasm?url")).default;
      R = await init({ locateFile: () => wasm });
    }
    // Unparseable SMILES are expected (that's what checking is for); don't log each one as an error.
    R.disable_logging();
    return R;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

export interface Identity {
  /** Canonical SMILES. */
  smiles: string;
  /** InChIKey; empty when there isn't one (structures with R groups). */
  key: string;
  /** Molecular formula, from the InChI. */
  formula: string;
}


export function identify(R: MainModule, smiles: string): Identity | null {
  const mol = R.get_mol(smiles);
  if (!mol) return null;
  try {
    if (!mol.is_valid()) return null;
    const inchi = mol.get_inchi();
    return {
      smiles: mol.get_smiles(),
      key: inchi ? R.get_inchikey_for_inchi(inchi) : "",
      formula: inchi.split("/")[1] ?? "",
    };
  } finally {
    mol.delete();
  }
}

// Heteroatom colours that read on both the light and the dark theme. Carbon and bonds are drawn
// in black and swapped for currentColor, so they follow the text colour.
const PALETTE: Record<number, [number, number, number]> = {
  0: [0.5, 0.5, 0.5], // R group (*)
  7: [0.2, 0.42, 0.95],
  8: [0.88, 0.2, 0.2],
  9: [0.2, 0.7, 0.3],
  15: [0.95, 0.5, 0.1],
  16: [0.8, 0.62, 0.05],
  17: [0.2, 0.7, 0.3],
  35: [0.72, 0.42, 0.18],
  53: [0.6, 0.3, 0.8],
};

const svgCache = new Map<string, { svg: string; width: number; height: number } | null>();

/** An SVG of the structure, sized to the molecule (a 30 px bond), or null if it isn't a valid structure. */
export function drawSvg(R: MainModule, smiles: string): { svg: string; width: number; height: number } | null {
  if (svgCache.has(smiles)) return svgCache.get(smiles)!;
  const mol = R.get_mol(smiles);
  let out: { svg: string; width: number; height: number } | null = null;
  if (mol) {
    try {
      const raw = mol.get_svg_with_highlights(
        JSON.stringify({
          width: -1,
          height: -1,
          fixedBondLength: 30,
          bondLineWidth: 1.5,
          padding: 0.06,
          clearBackground: false,
          atomColourPalette: PALETTE,
        }),
      );
      const size = /width='([\d.]+)px' height='([\d.]+)px'/.exec(raw);
      out = {
        svg: raw.replace(/<\?xml[^>]*>\s*/, "").replace(/<rect[^>]*>\s*<\/rect>/, "").replaceAll("#000000", "currentColor"),
        width: Number(size?.[1] ?? 100),
        height: Number(size?.[2] ?? 80),
      };
    } finally {
      mol.delete();
    }
  }
  svgCache.set(smiles, out);
  return out;
}

// ---------- Looking structures up by name ----------

export interface Lookup {
  smiles: string;
  source: "pubchem" | "opsin";
}

const env = {
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
  timeoutMs: 8000,
};

/** Lets tests stand in for PubChem and OPSIN. */
export function configureChem(patch: Partial<typeof env>): void {
  Object.assign(env, patch);
}

/** Thrown when a lookup service can't be reached, as opposed to it not knowing the name. */
class Unreachable extends Error {}

/** PubChem asks for at most 5 requests a second; this keeps starts 250 ms apart per service. */
function throttle(gapMs: number) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gapMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}
const pubchemTurn = throttle(250);
const opsinTurn = throttle(150);

async function get(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await env.fetch(url, { ...init, signal: AbortSignal.timeout(env.timeoutMs) });
  } catch (err) {
    throw new Unreachable((err as Error).message);
  }
}

/** A body that isn't the JSON asked for (a captive portal's page, a cut-off response) means the service couldn't be asked. */
async function json<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new Unreachable((err as Error).message);
  }
}

async function pubchem(name: string): Promise<Lookup | null> {
  await pubchemTurn();
  // POST, so names with slashes or commas need no URL escaping on PubChem's side.
  const res = await get("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/property/SMILES/JSON", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `name=${encodeURIComponent(name)}`,
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Unreachable(`PubChem ${res.status}`);
  const body = await json<{ PropertyTable?: { Properties?: { SMILES?: string }[] } }>(res);
  const smiles = body.PropertyTable?.Properties?.[0]?.SMILES;
  return smiles ? { smiles, source: "pubchem" } : null;
}

async function opsin(name: string): Promise<Lookup | null> {
  await opsinTurn();
  const res = await get(`https://www.ebi.ac.uk/opsin/ws/${encodeURIComponent(name)}.json`);
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Unreachable(`OPSIN ${res.status}`);
  const body = await json<{ status?: string; smiles?: string }>(res);
  return body.status === "SUCCESS" && body.smiles ? { smiles: body.smiles, source: "opsin" } : null;
}

/** Names that turned out not to exist are asked about again after this long. */
const MISS_TTL = 30 * 86_400_000;

/**
 * The structure a compound name stands for. null: neither service knows the name. undefined:
 * couldn't ask (offline, or a service down), so nothing can be concluded.
 */
export async function lookupName(name: string): Promise<Lookup | null | undefined> {
  const id = name.trim().toLowerCase();
  if (!id) return null;
  const cached = await db.molecules.get(id).catch(() => undefined);
  if (cached && (cached.smiles || Date.now() - cached.at < MISS_TTL)) return cached.smiles ? { smiles: cached.smiles, source: cached.source! } : null;
  let unreachable = false;
  // OPSIN first: it parses a systematic name into exactly the structure the name spells out.
  // PubChem's name search matches synonyms loosely; it answered "but-2-ynedinitrile" with
  // putrescine. It's there for the trade and common names OPSIN doesn't know.
  for (const source of [opsin, pubchem]) {
    try {
      const hit = await source(name.trim());
      if (hit) {
        await db.molecules.put({ id, smiles: hit.smiles, source: hit.source, at: Date.now() }).catch(() => {});
        return hit;
      }
    } catch (err) {
      if (!(err instanceof Unreachable)) throw err;
      unreachable = true;
    }
  }
  if (unreachable) return undefined;
  await db.molecules.put({ id, at: Date.now() }).catch(() => {});
  return null;
}

// ---------- Checking a structure against its name ----------

/** Stereodescriptors in a name: (R), (2S,3R), (E), cis-, trans-, meso-, and D-/L- for sugars and amino acids. */
export function nameHasStereo(name: string): boolean {
  return /\(\s*\d*[RSEZ]\*?(\s*,\s*\d*[RSEZ]\*?)*\s*\)/.test(name) || /\b(cis|trans|meso)\b/i.test(name) || /(^|[^A-Za-z])[DL]-[a-z]/.test(name);
}

/**
 * Whether the name fixes which enantiomer it is: R/S or D/L. "trans-1,2-dibromocyclohexane" names
 * both mirror images, and PubChem returns just one of them.
 */
const nameHasAbsoluteStereo = (name: string) => /\(\s*\d*[RS]\*?(\s*,\s*\d*[RSEZ]\*?)*\s*\)|\(\s*\d*[EZ](\s*,\s*\d*[EZ])*\s*,\s*\d*[RS]/.test(name) || /(^|[^A-Za-z])[DL]-[a-z]/.test(name);

/** The mirror image: every tetrahedral centre inverted. Double-bond geometry (/ and \\) is unchanged by mirroring. */
export const mirror = (smiles: string) => smiles.replace(/@@|@/g, (m) => (m === "@@" ? "@" : "@@"));

const smilesHasStereo = (smiles: string) => /[@/\\]/.test(smiles);

/**
 * The part of a structure that names compare on: the largest carbon-containing piece, so "sodium
 * ethoxide" and its ethoxide ion compare equal. For a salt with no carbon, all its pieces, in a
 * fixed order, so [Na+].[OH-] and [OH-].[Na+] are the same.
 */
function comparable(R: MainModule, smiles: string): Identity | null {
  const parts = smiles.split(".").map((s) => ({ s, id: identify(R, s) }));
  if (parts.some((p) => !p.id)) return null;
  const organic = parts.filter((p) => /C|c/.test(p.id!.formula));
  if (organic.length) return organic.reduce((a, b) => (b.id!.formula.length > a.id!.formula.length || (b.id!.formula.length === a.id!.formula.length && b.s.length > a.s.length) ? b : a)).id;
  const ids = parts.map((p) => p.id!).sort((a, b) => a.key.localeCompare(b.key));
  return { smiles: ids.map((i) => i.smiles).join("."), key: ids.map((i) => i.key.slice(0, 14)).join("+"), formula: ids.map((i) => i.formula).join(".") };
}

export type MolVerdict =
  /** Matches its name, or has no name to check against. */
  | { status: "ok" }
  /** Readable, but its name couldn't be looked up. */
  | { status: "unverified" }
  /** Unreadable, or missing the stereochemistry its name gives; `smiles` is the name's structure, to use instead. */
  | { status: "fixed"; smiles: string }
  /** The structure contradicts its name. `smiles` is the name's structure. */
  | { status: "mismatch"; smiles: string }
  /** Not a structure RDKit can read, and no name to recover it from. */
  | { status: "invalid" };

export async function verifyMol(R: MainModule, t: MolToken): Promise<MolVerdict> {
  const drawn = comparable(R, t.smiles);
  if (!t.name) return drawn ? { status: "ok" } : { status: "invalid" };
  const found = await lookupName(t.name);
  if (!found) return drawn ? { status: "unverified" } : { status: "invalid" };
  const named = comparable(R, found.smiles);
  if (!named) return drawn ? { status: "unverified" } : { status: "invalid" };
  if (!drawn) return { status: "fixed", smiles: found.smiles };
  // R groups have no InChI, so there's nothing to compare.
  if (!drawn.key || !named.key) return { status: "unverified" };
  // The first block of an InChIKey is the skeleton; the second adds stereochemistry.
  if (drawn.key.slice(0, 14) !== named.key.slice(0, 14)) return { status: "mismatch", smiles: found.smiles };
  if (!nameHasStereo(t.name) || drawn.key.slice(0, 25) === named.key.slice(0, 25)) return { status: "ok" };
  // cis/trans on a ring without R/S: either mirror image is the compound the name means.
  if (!nameHasAbsoluteStereo(t.name) && comparable(R, mirror(t.smiles))?.key.slice(0, 25) === named.key.slice(0, 25)) return { status: "ok" };
  return smilesHasStereo(t.smiles) ? { status: "mismatch", smiles: found.smiles } : { status: "fixed", smiles: found.smiles };
}

const tokenKey = (t: MolToken) => `${t.smiles}|${t.name ?? ""}`;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    for (let n = i++; n < items.length; n = i++) out[n] = await fn(items[n]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Verdicts for every token in the texts, each distinct token checked once. */
export async function checkTokens(texts: string[]): Promise<Map<string, MolVerdict>> {
  const unique = new Map<string, MolToken>();
  for (const text of texts) for (const t of molTokens(text)) unique.set(tokenKey(t), t);
  const verdicts = new Map<string, MolVerdict>();
  if (!unique.size) return verdicts;
  const R = await rdkit();
  const list = [...unique.entries()];
  // One structure that can't be checked mustn't cost the whole batch.
  const results = await mapLimit(list, 4, ([, t]) =>
    verifyMol(R, t).catch((err): MolVerdict => {
      console.warn("Couldn't check a structure", t, err);
      return identify(R, t.smiles) ? { status: "unverified" } : { status: "invalid" };
    }),
  );
  list.forEach(([key], i) => verdicts.set(key, results[i]));
  return verdicts;
}

/** Swaps in the name's structure where the check produced one. With `fixMismatch`, contradicting structures too. */
function applyVerdicts(text: string, verdicts: Map<string, MolVerdict>, fixMismatch: boolean): string {
  return replaceMols(text, (t, raw) => {
    const v = verdicts.get(tokenKey(t));
    if (v?.status === "fixed" || (fixMismatch && v?.status === "mismatch")) return `{{mol:${v.smiles}${t.name ? `|${t.name}` : ""}}}`;
    return raw;
  });
}

const broken = (text: string, verdicts: Map<string, MolVerdict>, mismatchBreaks: boolean) =>
  molTokens(text).some((t) => {
    const s = verdicts.get(tokenKey(t))?.status;
    return s === "invalid" || (mismatchBreaks && s === "mismatch");
  });

/** Two options that are the same molecule drawn differently. */
function sameStructures(R: MainModule, options: string[]): boolean {
  const ids = options.filter(onlyMols).map((o) => {
    const [t] = molTokens(o);
    const id = comparable(R, t.smiles);
    return id ? `${id.key || id.smiles}` : t.smiles;
  });
  return new Set(ids).size < ids.length;
}

interface QuestionLike {
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  hint: string;
}

/**
 * Keeps the questions whose structures hold up: a structure that contradicts its name, can't be
 * read, or duplicates another option drops the question. Structures missing their name's
 * stereochemistry get it filled in. Questions without structures pass through untouched.
 */
export async function checkQuestions<T extends QuestionLike>(questions: T[]): Promise<{ kept: T[]; dropped: { prompt: string; why: string }[] }> {
  const fields = (q: T) => [q.prompt, ...q.options, q.answer, q.explanation, q.hint];
  if (!questions.some((q) => fields(q).some(hasMol))) return { kept: questions, dropped: [] };
  const verdicts = await checkTokens(questions.flatMap(fields));
  const R = await rdkit();
  const kept: T[] = [];
  const dropped: { prompt: string; why: string }[] = [];
  for (const q of questions) {
    const bad = fields(q)
      .flatMap((f) => molTokens(f))
      .find((t) => ["invalid", "mismatch"].includes(verdicts.get(tokenKey(t))?.status ?? ""));
    if (bad) {
      dropped.push({ prompt: q.prompt, why: `${verdicts.get(tokenKey(bad))!.status}: {{mol:${bad.smiles}${bad.name ? `|${bad.name}` : ""}}}` });
      continue;
    }
    const fix = (s: string) => applyVerdicts(s, verdicts, false);
    const fixed = { ...q, prompt: fix(q.prompt), options: q.options.map(fix), answer: fix(q.answer), explanation: fix(q.explanation), hint: fix(q.hint) };
    if (sameStructures(R, fixed.options)) {
      dropped.push({ prompt: q.prompt, why: "two options are the same molecule" });
      continue;
    }
    kept.push(fixed);
  }
  return { kept, dropped };
}

/** Cards and sheets: a structure that contradicts its name is replaced by the name's; an unreadable one drops the item. */
export async function checkItems<T>(items: T[], fields: (item: T) => string[], rebuild: (item: T, fix: (s: string) => string) => T): Promise<T[]> {
  if (!items.some((it) => fields(it).some(hasMol))) return items;
  const verdicts = await checkTokens(items.flatMap(fields));
  return items.filter((it) => !fields(it).some((f) => broken(f, verdicts, false))).map((it) => rebuild(it, (s) => applyVerdicts(s, verdicts, true)));
}

/** Long text (guides, summaries): fix what can be fixed; an unreadable token stays and draws as its name. */
export async function checkText(text: string): Promise<string> {
  if (!hasMol(text)) return text;
  return applyVerdicts(text, await checkTokens([text]), true);
}
