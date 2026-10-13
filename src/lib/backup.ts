import { blobToBase64 } from "./extract";
import { base64ToBytes } from "./gemini";
import { db, KIT_TABLES, type Output } from "./db";
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
          return includeAudio && audio ? { ...rest, audioBase64: await blobToBase64(audio) } : rest;
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
          r.audio = new Blob([base64ToBytes(r.audioBase64) as BlobPart], { type: "audio/wav" });
          delete r.audioBase64;
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
