/** Wraps 16-bit mono PCM chunks in a single WAV file, with a short pause between chunks. */
export function pcmToWav(chunks: Uint8Array[], sampleRate: number, gapMs = 350): Uint8Array {
  const gap = new Uint8Array(Math.round((sampleRate * gapMs) / 1000) * 2);
  const parts = chunks.flatMap((c, i) => (i === 0 ? [c] : [gap, c]));
  const dataLen = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(44 + dataLen);
  const v = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => [...s].forEach((ch, i) => v.setUint8(offset + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, dataLen, true);
  let offset = 44;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function pcmSeconds(bytes: number, sampleRate: number): number {
  return bytes / 2 / sampleRate;
}
