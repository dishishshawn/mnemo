// Structure tokens. Gemini writes a molecule as {{mol:SMILES|name}} (the name is optional) wherever
// a structure belongs; Markdown.tsx draws them and chem.ts checks them. Pure string helpers, safe to
// import anywhere.

export interface MolToken {
  smiles: string;
  /** A specific compound's name. Left out for intermediates, carbocations and generic structures. */
  name?: string;
}

const TOKEN = /\{\{mol:([^{}|\s]+)(?:\|([^{}]*))?\}\}/g;

export const hasMol = (text: string) => text.includes("{{mol:");

export function molTokens(text: string): MolToken[] {
  return [...text.matchAll(TOKEN)].map((m) => ({ smiles: m[1], name: m[2]?.trim() || undefined }));
}

export function molToken(t: MolToken): string {
  return `{{mol:${t.smiles}${t.name ? `|${t.name}` : ""}}}`;
}

export function replaceMols(text: string, fn: (t: MolToken, raw: string) => string): string {
  return text.replace(TOKEN, (raw, smiles: string, name?: string) => fn({ smiles, name: name?.trim() || undefined }, raw));
}

/** True when the text is nothing but structure tokens (an answer option that is a structure). */
export const onlyMols = (text: string) => hasMol(text) && !text.replace(TOKEN, "").trim();

/** Each token as its name ("a structure" without one), for plain-text places: games, the podcast script. */
export const molsAsText = (text: string) => replaceMols(text, (t) => t.name ?? "a structure");

const EATEN: Record<string, string> = { "\b": "b", "\f": "f", "\t": "t", "\r": "r", "\n": "n" };

/**
 * JSON escapes eat backslashes the same way they do in LaTeX (latex.ts): a SMILES bond "\" before
 * "n" (an aromatic nitrogen) arrives as a newline. Inside a token any such character was a backslash.
 */
export function repairMolTokens(s: string): string {
  if (!hasMol(s) || !/[\b\f\t\r\n]/.test(s)) return s;
  return s.replace(/\{\{mol:[^{}]*\}\}/g, (span) => span.replace(/[\b\f\t\r\n]/g, (ch) => `\\${EATEN[ch]}`));
}
