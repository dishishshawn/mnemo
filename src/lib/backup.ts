import { blobToBase64 } from "./extract";
import { base64ToBytes } from "./gemini";
import { audioBlob, db, KIT_TABLES, type Figure, type Output } from "./db";
import { reviveCard } from "./srs";

const TABLES = ["folders", "kits", ...KIT_TABLES, "usage"] as const;
type TableName = (typeof TABLES)[number];

interface Backup {
  app: "mnemo";
  version: 1;
  exportedAt: string;
  tables: Partial<Record<TableName, unknown[]>>;
}

export async function exportAll(includeAudio: boolean): Promise<Blob> {
  const tables: Backup["tables"] = {};
  for (const name of TABLES) {
    let rows = (await db[name].toArray()) as unknown[];
    if (name === "outputs") {
      rows = await Promise.all(
        (rows as Output[]).map(async (o) => {
          const { audio, ...rest } = o;
          return includeAudio && audio ? { ...rest, audioBase64: await blobToBase64(audioBlob(audio)) } : rest;
        }),
      );
    }
    // Diagram images are small and the cards are useless without them, so they're always included.
    if (name === "figures") {
      rows = await Promise.all(
        (rows as Figure[]).map(async (f) => {
          const { image, ...rest } = f;
          return image ? { ...rest, imageBase64: await blobToBase64(new Blob([image])) } : rest;
        }),
      );
    }
    tables[name] = rows;
  }
  const backup: Backup = { app: "mnemo", version: 1, exportedAt: new Date().toISOString(), tables };
  return new Blob([JSON.stringify(backup)], { type: "application/json" });
}

/** Merges a backup into the current data. Rows with the same id are overwritten. */
export async function importAll(file: File): Promise<number> {
  const backup = JSON.parse(await file.text()) as Backup;
  if (backup.app !== "mnemo") throw new Error("That file isn't a Mnemo backup.");
  let count = 0;
  await db.transaction("rw", TABLES.map((t) => db[t]), async () => {
    for (const name of TABLES) {
      const rows = (backup.tables[name] ?? []) as Record<string, unknown>[];
      const revived = rows.map((row) => {
        const r = { ...row };
        if (r.srs) r.srs = reviveCard(r.srs as Parameters<typeof reviveCard>[0]);
        if (typeof r.audioBase64 === "string") {
          const bytes = base64ToBytes(r.audioBase64);
          r.audio = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          delete r.audioBase64;
        }
        if (typeof r.imageBase64 === "string") {
          const bytes = base64ToBytes(r.imageBase64);
          r.image = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          delete r.imageBase64;
        }
        return r;
      });
      // Dexie's table types differ per table; rows come from our own export.
      await (db[name] as unknown as { bulkPut: (rows: unknown[]) => Promise<unknown> }).bulkPut(revived);
      count += revived.length;
    }
  });
  return count;
}
