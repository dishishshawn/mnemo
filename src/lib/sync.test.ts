import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { deriveKeys, formatCode, newSyncCode, normalizeCode, open, seal } from "./crypto";
import { db, KIT_TABLES, newId, SYNC_TABLES, type Kit } from "./db";
import { getSettings, updateSettings } from "./settings";
import { newCard } from "./srs";
import { __test, configureSync, disableSync, enableSync, installChangeTracking, syncNow } from "./sync";

// ---------- A fake /api/sync with the real server's semantics ----------

const server = new Map<string, { bytes: Uint8Array; etag: string }>();
let failNextPutWith412 = false;
let etagSeq = 0;

configureSync({
  api: "https://fake/api/sync",
  pushDelayMs: 60_000_000, // tests call syncNow explicitly
  fetch: async (input, init) => {
    const url = new URL(input);
    const key = `${url.searchParams.get("vault")}/${url.searchParams.get("name")}`;
    const headers = new Headers(init?.headers);
    const current = server.get(key);
    if ((init?.method ?? "GET") === "GET") {
      if (!current) return new Response(null, { status: 204 });
      // Like Vercel's CDN: ETag arrives weakened; X-Etag carries the exact value.
      const tags = { ETag: `W/${current.etag}`, "X-Etag": current.etag };
      if (headers.get("If-None-Match")?.replace(/^W\//, "") === current.etag) return new Response(null, { status: 304, headers: tags });
      return new Response(current.bytes as BodyInit, { headers: tags });
    }
    const isState = key.endsWith("/state");
    const ifMatch = headers.get("If-Match")?.replace(/^W\//, "");
    if (isState && failNextPutWith412) {
      failNextPutWith412 = false;
      return Response.json({}, { status: 412 });
    }
    if (isState && ifMatch && current?.etag !== ifMatch) return Response.json({}, { status: 412 });
    if (isState && !ifMatch && current) return Response.json({}, { status: 412 });
    const bytes = new Uint8Array(await new Response(init!.body as BodyInit).arrayBuffer());
    const etag = `"e${++etagSeq}"`;
    server.set(key, { bytes, etag });
    return Response.json({ etag });
  },
});

// ---------- Simulating devices in one process ----------

type Dump = Record<string, unknown[]>;
interface Device {
  dump: Dump;
  state: ReturnType<typeof __test.getState>;
  dirty: string | null;
}

async function dumpDb(): Promise<Dump> {
  const out: Dump = {};
  for (const t of [...SYNC_TABLES, "tombstones"] as const) out[t] = await db.table(t).toArray();
  return out;
}

async function loadDb(d: Dump) {
  // Untracked, so restored rows keep their original _ts, as on a real second device.
  await __test.untracked(async () => {
    for (const t of [...SYNC_TABLES, "tombstones"] as const) await db.table(t).clear();
    for (const [t, rows] of Object.entries(d)) if (rows.length) await db.table(t).bulkAdd(rows);
  });
}

async function save(): Promise<Device> {
  await new Promise((r) => setTimeout(r, 5)); // let tombstone writes flush
  return { dump: await dumpDb(), state: __test.getState(), dirty: __test.dirty() };
}

async function restore(d: Device) {
  await loadDb(d.dump);
  __test.setState(d.state);
  __test.setDirty(d.dirty);
}

async function freshDevice() {
  disableSync();
  __test.setDirty(null);
  await loadDb({});
}

const kit = (title: string): Kit => ({
  id: newId(),
  title,
  description: "",
  emoji: "📚",
  language: "auto",
  status: "ready",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const tick = () => new Promise((r) => setTimeout(r, 3));

beforeAll(() => installChangeTracking());

describe("sync crypto", () => {
  it("makes valid codes and normalizes typing mistakes", () => {
    const code = newSyncCode();
    expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/);
    const raw = normalizeCode(code)!;
    expect(normalizeCode(code.toLowerCase().replace(/-/g, " "))).toBe(raw);
    expect(normalizeCode("OIL00-00000-00000-00000")).toBe("01100000000000000000");
    expect(normalizeCode("too short")).toBeNull();
    expect(formatCode(raw)).toBe(code);
  });

  it("derives the same vault and key from the same code, different from other codes", async () => {
    const code = newSyncCode();
    const a = await deriveKeys(code);
    const b = await deriveKeys(code.toLowerCase());
    const c = await deriveKeys(newSyncCode());
    expect(a.vaultId).toMatch(/^[0-9a-f]{64}$/);
    expect(a.vaultId).toBe(b.vaultId);
    expect(a.vaultId).not.toBe(c.vaultId);
    const sealed = await seal({ hello: "world", n: [1, 2, 3] }, a.key);
    expect(await open(sealed, b.key)).toEqual({ hello: "world", n: [1, 2, 3] });
    await expect(open(sealed, c.key)).rejects.toThrow(/decrypt/);
  });
});

describe("sync between devices", () => {
  it("converges, carries settings and source text, propagates deletes, and survives conflicts", async () => {
    // Device A: a kit with a card and a source, and an API key.
    await freshDevice();
    const k1 = kit("Biology");
    await db.kits.add(k1);
    const cardId = newId();
    await db.flashcards.add({ id: cardId, kitId: k1.id, front: "ATP", back: "energy", kind: "term", srs: newCard(), createdAt: 1 });
    const srcId = newId();
    await db.sources.add({ id: srcId, kitId: k1.id, kind: "text", name: "notes", text: "Mitochondria make ATP.", status: "ready", createdAt: 1 });
    updateSettings({ apiKey: "KEY-FROM-A" });
    const code = await enableSync();
    expect(__test.dirty()).toBeNull();
    const deviceA = await save();

    // Device B: its own kit, a different key from long ago; joins with A's code.
    await freshDevice();
    const k2 = kit("History");
    await db.kits.add(k2);
    await expect(enableSync("AAAAA-AAAAA-AAAAA-AAAAA")).rejects.toThrow(/No synced data/);
    await enableSync(code.toLowerCase());
    expect((await db.kits.toArray()).map((k) => k.title).sort()).toEqual(["Biology", "History"]);
    expect((await db.flashcards.get(cardId))?.srs.due).toBeInstanceOf(Date);
    expect((await db.sources.get(srcId))?.text).toBe("Mitochondria make ATP.");
    expect(getSettings().apiKey).toBe("KEY-FROM-A");

    // B deletes the card and renames A's kit.
    await db.flashcards.delete(cardId);
    await tick();
    await db.kits.update(k1.id, { title: "Biology 101" });
    await syncNow();
    expect(__test.dirty()).toBeNull();
    const deviceB = await save();

    // Back on A, which still has the card and the old title: one sync brings it up to date.
    await restore(deviceA);
    expect(await db.flashcards.get(cardId)).toBeDefined();
    await syncNow();
    expect(await db.flashcards.get(cardId)).toBeUndefined();
    expect((await db.kits.get(k1.id))?.title).toBe("Biology 101");
    expect((await db.kits.get(k2.id))?.title).toBe("History");

    // Concurrent edits: A edits now, but B's upload lands first (A's PUT gets 412) -> A re-pulls, merges, wins on recency.
    await db.kits.update(k2.id, { title: "History (A)" });
    failNextPutWith412 = true;
    await syncNow();
    expect(__test.dirty()).toBeNull();
    expect((await db.kits.get(k2.id))?.title).toBe("History (A)");

    // B pulls A's latest.
    const deviceA2 = await save();
    await restore(deviceB);
    await syncNow();
    expect((await db.kits.get(k2.id))?.title).toBe("History (A)");

    // Deleting a kit on B removes it and all its rows on A.
    const { deleteKit } = await import("./db");
    await deleteKit(k1.id);
    await tick();
    await syncNow();
    await restore(deviceA2);
    await syncNow();
    expect(await db.kits.get(k1.id)).toBeUndefined();
    for (const t of KIT_TABLES) expect(await db.table(t).where("kitId").equals(k1.id).count()).toBe(0);
    expect(await db.kits.get(k2.id)).toBeDefined();
  });

  it("stamps edits made with put() on an existing row", async () => {
    await freshDevice();
    const k = kit("Put me");
    await db.kits.add(k);
    const before = (await db.kits.get(k.id)) as Kit & { _ts: number };
    await tick();
    await db.kits.put({ ...before, title: "Put again" });
    const after = (await db.kits.get(k.id)) as Kit & { _ts: number };
    expect(after._ts).toBeGreaterThan(before._ts);
  });

  it("doesn't share kits that are still being built", async () => {
    await freshDevice();
    const building = { ...kit("Half done"), status: "processing" as const };
    await db.kits.add(building);
    const code = await enableSync();
    await freshDevice();
    await enableSync(code);
    expect(await db.kits.get(building.id)).toBeUndefined();
  });
});
