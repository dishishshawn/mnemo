// Splitting kit material into chunks so question generation can send only the sections that
// teach the concepts being practised. Chunk keys are content hashes, so they stay valid when
// sources are added, removed or reordered.

export interface Chunk {
  key: string;
  text: string;
}

/** ~450 tokens. Big enough to keep a figure description with its slide, small enough to select precisely. */
const CHUNK_CHARS = 1800;

/** FNV-1a, 32-bit, as 8 hex chars. Collisions within one kit are vanishingly unlikely. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function chunkMaterial(material: string): Chunk[] {
  const paragraphs = material.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const texts: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    const startsSection = /^(#|# Source:)/.test(p);
    if (current && (current.length + p.length + 2 > CHUNK_CHARS || (startsSection && current.length > CHUNK_CHARS / 3))) {
      texts.push(current);
      current = "";
    }
    if (p.length > CHUNK_CHARS * 2) {
      // A single huge paragraph (e.g. a wall of transcript): hard-split it.
      if (current) texts.push(current);
      current = "";
      for (let i = 0; i < p.length; i += CHUNK_CHARS) texts.push(p.slice(i, i + CHUNK_CHARS));
      continue;
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) texts.push(current);
  return texts.map((text) => ({ key: hashText(text), text }));
}

/** The material with a marker before each chunk, so the model can refer to chunks by number. */
export function markedMaterial(chunks: Chunk[]): string {
  return chunks.map((c, i) => `<!-- chunk ${i} -->\n${c.text}`).join("\n\n");
}

/** Above this, sending only the relevant chunks is worth it; below, the cache discount on the whole thing wins. */
export const FOCUS_MIN_CHARS = 40_000; // ~10k tokens
/** If the relevant chunks are most of the material anyway, just send all of it. */
const FOCUS_MAX_SHARE = 0.6;

/**
 * Picks the chunks that teach the target concepts (plus each one's neighbours, so a figure or
 * example isn't cut off from its slide). Returns null when the whole material should be sent:
 * the kit is small, a target has no known chunks, or the selection is most of the material.
 */
export function focusMaterial(chunks: Chunk[], targetChunkKeys: (string[] | undefined)[]): string | null {
  const total = chunks.reduce((n, c) => n + c.text.length, 0);
  if (total < FOCUS_MIN_CHARS) return null;
  if (targetChunkKeys.some((keys) => !keys?.length)) return null;
  const index = new Map(chunks.map((c, i) => [c.key, i]));
  const picked = new Set<number>();
  for (const keys of targetChunkKeys)
    for (const key of keys!) {
      const i = index.get(key);
      if (i === undefined) continue;
      for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < chunks.length) picked.add(j);
    }
  if (!picked.size) return null;
  const selected = [...picked].sort((a, b) => a - b);
  const size = selected.reduce((n, i) => n + chunks[i].text.length, 0);
  if (size > total * FOCUS_MAX_SHARE) return null;
  const parts: string[] = [];
  let last = -2;
  for (const i of selected) {
    if (i !== last + 1) parts.push("[…]");
    parts.push(chunks[i].text);
    last = i;
  }
  return `(Excerpts of the course material covering the target concepts; "[…]" marks omitted sections.)\n\n${parts.join("\n\n")}`;
}
