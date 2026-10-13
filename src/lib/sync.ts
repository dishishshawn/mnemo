// Cross-device sync. Each device keeps a full copy in IndexedDB; sync exchanges an encrypted
// snapshot through /api/sync and merges it record by record:
//   - every local write stamps the row with `_ts` (hooks below); on merge the newer `_ts` wins
//   - deletes leave tombstones, which travel with the snapshot and delete the row elsewhere
//   - uploads are compare-and-swap on the server's ETag; on conflict we re-pull, merge, retry
// Source texts (the big part) go up once each as separate blobs; podcast audio stays per device.
import { useSyncExternalStore } from "react";
import type { Transaction } from "dexie";
import { deriveKeys, formatCode, newSyncCode, normalizeCode, open, seal, type VaultKeys } from "./crypto";
import { db, SYNC_TABLES, type SyncTable, type Tombstone } from "./db";
import { applyRemoteSettings, getSettings, LOCAL_ONLY, onSettingsEdited, settingsTs, type Settings } from "./settings";
import { reviveCard } from "./srs";

type Row = Record<string, unknown> & { id: string; _ts?: number; kitId?: string };

interface Snapshot {
  v: 1;
  at: number;
  settings: { values: Partial<Settings>; ts: number };
  tables: Partial<Record<SyncTable, Row[]>>;
  tombstones: Tombstone[];
}

interface SyncState {
  code: string;
  etag: string | null;
  lastSync: number | null;
  /** Source ids whose text this device has uploaded. */
  uploaded: string[];
}

export interface SyncStatus {
  enabled: boolean;
  phase: "idle" | "syncing" | "error";
  lastSync: number | null;
  error?: string;
}

const TOMBSTONE_TTL = 120 * 86_400_000;

// ---------- Small persistent store (localStorage, in-memory fallback for tests) ----------

const mem = new Map<string, string>();
const kv = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return mem.get(k) ?? null;
    }
  },
  set(k: string, v: string) {
    mem.set(k, v);
    try {
      localStorage.setItem(k, v);
    } catch {
      // memory only
    }
  },
  del(k: string) {
    mem.delete(k);
    try {
      localStorage.removeItem(k);
    } catch {
      // memory only
    }
  },
};

const STATE_KEY = "mnemo.sync";
const DIRTY_KEY = "mnemo.sync.dirty";

function loadState(): SyncState | null {
  try {
    const raw = kv.get(STATE_KEY);
    return raw ? (JSON.parse(raw) as SyncState) : null;
  } catch {
    return null;
  }
}
const saveState = (s: SyncState) => kv.set(STATE_KEY, JSON.stringify(s));
const dirtyStamp = () => kv.get(DIRTY_KEY);
const clearDirty = () => kv.del(DIRTY_KEY);

// ---------- Environment (overridable for tests) ----------

const env = {
  api: "/api/sync",
  fetch: (input: string, init?: RequestInit) => fetch(input, init),
  /** Debounce for pushing local changes; long enough to batch a study session's writes. */
  pushDelayMs: 30_000,
};

export function configureSync(patch: Partial<typeof env>) {
  Object.assign(env, patch);
}

// ---------- Status for the UI ----------

let status: SyncStatus = { enabled: !!loadState(), phase: "idle", lastSync: loadState()?.lastSync ?? null };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export function syncCode(): string | null {
  return loadState()?.code ?? null;
}

// ---------- Change tracking ----------

/** Transactions that apply remote data are tagged so the hooks don't treat them as local edits. */
const REMOTE = Symbol("mnemo-remote");

function isRemote(tx: Transaction | undefined): boolean {
  for (let t: Transaction | undefined = tx; t; t = t.parent) if ((t as unknown as Record<symbol, boolean>)[REMOTE]) return true;
  return false;
}

let pendingTombs: Tombstone[] = [];
let tombTimer: ReturnType<typeof setTimeout> | null = null;

function flushTombs() {
  tombTimer = null;
  const batch = pendingTombs;
  pendingTombs = [];
  if (batch.length) db.tombstones.bulkPut(batch).catch(() => {});
}

function markDirty() {
  if (!dirtyStamp()) kv.set(DIRTY_KEY, String(Date.now()));
  schedulePush();
}

let tracking = false;

/** Must run before the app writes anything. */
export function installChangeTracking(): void {
  if (tracking) return;
  tracking = true;
  for (const name of SYNC_TABLES) {
    const table = db.table(name);
    table.hook("creating", function (_key, obj: Row, tx) {
      if (isRemote(tx)) return;
      obj._ts = Date.now();
      markDirty();
    });
    table.hook("updating", function (_mods, _key, _obj, tx) {
      if (isRemote(tx)) return;
      markDirty();
      return { _ts: Date.now() };
    });
    table.hook("deleting", function (key, _obj, tx) {
      if (isRemote(tx)) return;
      this.onsuccess = () => {
        pendingTombs.push({ id: `${name}:${key}`, table: name, key: String(key), at: Date.now() });
        tombTimer ??= setTimeout(flushTombs, 0);
        markDirty();
      };
    });
  }
  onSettingsEdited(markDirty);
}

// ---------- Snapshot ----------

/** Rows mid-processing on this device aren't shared until they settle. */
function shareable(name: SyncTable, row: Row): boolean {
  if (name === "kits") return row.status !== "processing";
  if (name === "sources") return row.status !== "processing" && row.status !== "pending";
  return true;
}

export async function buildSnapshot(): Promise<Snapshot> {
  const tables: Snapshot["tables"] = {};
  for (const name of SYNC_TABLES) {
    const rows = (await db.table(name).toArray()) as Row[];
    tables[name] = rows.filter((r) => shareable(name, r)).map((r) => {
      if (name === "sources") {
        const { text, ...rest } = r;
        return { ...rest, hasText: !!(text as string | undefined)?.trim() };
      }
      if (name === "outputs") {
        const { audio, ...rest } = r;
        return { ...rest, audioOnDevice: !!audio };
      }
      return r;
    });
  }
  const cutoff = Date.now() - TOMBSTONE_TTL;
  const tombstones = (await db.tombstones.toArray()).filter((t) => t.at > cutoff);
  const values: Partial<Settings> = { ...getSettings() };
  for (const k of LOCAL_ONLY) delete values[k];
  return { v: 1, at: Date.now(), settings: { values, ts: settingsTs() }, tables, tombstones };
}

/** Fields that exist only locally and must survive a remote row replacing the local one. */
function keepLocal(name: SyncTable, incoming: Row, local: Row | undefined): Row {
  const row: Row = { ...incoming };
  if (row.srs) row.srs = reviveCard(row.srs as Parameters<typeof reviveCard>[0]);
  if (name === "sources") row.text = (local?.text as string | undefined) || "";
  if (name === "outputs") {
    row.audio = local?.audio;
    delete row.audioOnDevice;
  }
  return row;
}

/** Merges a remote snapshot into the local database. Returns how many rows changed locally. */
export async function mergeSnapshot(remote: Snapshot): Promise<number> {
  let changed = 0;
  const tables = [...SYNC_TABLES.map((t) => db.table(t)), db.tombstones];
  await db.transaction("rw", tables, async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;

    const localTombs = new Map((await db.tombstones.toArray()).map((t) => [t.id, t]));
    const newer = remote.tombstones.filter((t) => (localTombs.get(t.id)?.at ?? -1) < t.at);
    if (newer.length) await db.tombstones.bulkPut(newer);
    const tombs = new Map(localTombs);
    for (const t of newer) tombs.set(t.id, t);
    const deadKits = new Set([...tombs.values()].filter((t) => t.table === "kits").map((t) => t.key));

    for (const name of SYNC_TABLES) {
      const table = db.table(name);
      const rows = remote.tables[name] ?? [];
      const locals = (await table.bulkGet(rows.map((r) => r.id))) as (Row | undefined)[];
      const puts: Row[] = [];
      rows.forEach((r, i) => {
        const tomb = tombs.get(`${name}:${r.id}`);
        if (tomb && tomb.at >= (r._ts ?? 0)) return;
        if (r.kitId && deadKits.has(r.kitId)) return;
        const local = locals[i];
        if (local && (local._ts ?? 0) >= (r._ts ?? 0)) return;
        puts.push(keepLocal(name, r, local));
      });
      if (puts.length) {
        await table.bulkPut(puts);
        changed += puts.length;
      }

      // Apply deletions that are newer than the local row.
      const ours = [...tombs.values()].filter((t) => t.table === name);
      if (ours.length) {
        const targets = (await table.bulkGet(ours.map((t) => t.key))) as (Row | undefined)[];
        const doomed = targets.filter((row, i): row is Row => !!row && (row._ts ?? 0) <= ours[i].at).map((row) => row.id);
        if (doomed.length) {
          await table.bulkDelete(doomed);
          changed += doomed.length;
        }
      }
      if (deadKits.size && name !== "kits" && name !== "folders") {
        const orphans = await table.where("kitId").anyOf([...deadKits]).primaryKeys();
        if (orphans.length) {
          await table.bulkDelete(orphans);
          changed += orphans.length;
        }
      }
    }
  });
  if (remote.settings && remote.settings.ts > settingsTs()) applyRemoteSettings(remote.settings.values, remote.settings.ts);
  return changed;
}

// ---------- Network ----------

async function api(method: "GET" | "PUT", keys: VaultKeys, name: string, opts: { body?: Uint8Array; etag?: string | null } = {}) {
  const headers: Record<string, string> = {};
  if (opts.etag) headers[method === "GET" ? "If-None-Match" : "If-Match"] = opts.etag;
  const url = `${env.api}?vault=${keys.vaultId}&name=${name}`;
  return env.fetch(url, { method, headers, body: opts.body as BodyInit | undefined, cache: "no-store" });
}

let keyCache: { code: string; keys: VaultKeys } | null = null;
async function keysFor(code: string): Promise<VaultKeys> {
  if (keyCache?.code !== code) keyCache = { code, keys: await deriveKeys(code) };
  return keyCache.keys;
}

async function pull(keys: VaultKeys, st: SyncState): Promise<"merged" | "unchanged" | "missing"> {
  const res = await api("GET", keys, "state", { etag: st.etag });
  if (res.status === 304) return "unchanged";
  if (res.status === 204 || res.status === 404) {
    st.etag = null;
    return "missing";
  }
  if (!res.ok) throw new Error(`Couldn't reach sync (${res.status}).`);
  const snapshot = await open<Snapshot>(new Uint8Array(await res.arrayBuffer()), keys.key);
  await mergeSnapshot(snapshot);
  // X-Etag is the exact value; the CDN may have weakened ETag to W/"…".
  st.etag = res.headers.get("X-Etag") ?? res.headers.get("ETag")?.replace(/^W\//, "") ?? null;
  return "merged";
}

async function uploadTexts(keys: VaultKeys, st: SyncState) {
  const done = new Set(st.uploaded);
  const sources = await db.sources.filter((s) => s.status === "ready" && !!s.text.trim() && !done.has(s.id)).toArray();
  for (const s of sources) {
    const res = await api("PUT", keys, `src-${s.id}`, { body: await seal({ text: s.text }, keys.key) });
    if (!res.ok) throw new Error(`Couldn't upload "${s.name}" (${res.status}).`);
    st.uploaded.push(s.id);
    saveState(st);
  }
}

async function downloadTexts(keys: VaultKeys) {
  const missing = await db.sources.filter((s) => s.status === "ready" && !s.text && !!(s as unknown as Row).hasText).toArray();
  for (const s of missing) {
    const res = await api("GET", keys, `src-${s.id}`);
    if (res.status === 204 || res.status === 404) continue; // its device hasn't uploaded it yet
    if (!res.ok) throw new Error(`Couldn't download "${s.name}" (${res.status}).`);
    const { text } = await open<{ text: string }>(new Uint8Array(await res.arrayBuffer()), keys.key);
    await db.transaction("rw", db.sources, async (tx) => {
      (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
      await db.sources.update(s.id, { text });
    });
  }
}

// ---------- The sync loop ----------

let running: Promise<void> | null = null;
let rerun = false;

export function syncNow(): Promise<void> {
  const st = loadState();
  if (!st) return Promise.resolve();
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    setStatus({ enabled: true, phase: "syncing", error: undefined });
    try {
      const keys = await keysFor(st.code);
      for (let attempt = 0; ; attempt++) {
        if (attempt >= 4) throw new Error("Sync kept conflicting with another device. It will retry.");
        const pulled = await pull(keys, st);
        saveState(st);
        await downloadTexts(keys);
        const dirtyAt = dirtyStamp();
        if (!dirtyAt && pulled !== "missing") break;
        await uploadTexts(keys, st);
        const body = await seal(await buildSnapshot(), keys.key);
        const res = await api("PUT", keys, "state", { body, etag: st.etag });
        if (res.status === 412) continue; // another device saved first: pull, merge, try again
        if (!res.ok) throw new Error(res.status === 413 ? "Too much data to sync in one piece." : `Sync upload failed (${res.status}).`);
        st.etag = ((await res.json()) as { etag: string }).etag;
        if (dirtyStamp() === dirtyAt) clearDirty(); // edits made during the upload stay pending
        break;
      }
      st.lastSync = Date.now();
      saveState(st);
      setStatus({ phase: "idle", lastSync: st.lastSync });
    } catch (err) {
      setStatus({ phase: "error", error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = null;
      if (rerun) {
        rerun = false;
        void syncNow();
      }
    }
  })();
  return running;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let firstDirtyAt = 0;

function schedulePush() {
  if (!loadState()) return;
  const now = Date.now();
  if (!pushTimer) firstDirtyAt = now;
  if (pushTimer) clearTimeout(pushTimer);
  // Debounce, but never hold changes for more than 2 minutes.
  const wait = Math.max(0, Math.min(env.pushDelayMs, firstDirtyAt + 120_000 - now));
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void syncNow();
  }, wait);
}

// ---------- Turning it on and off ----------

/** Stamps rows written before sync existed so they take part in merges, and queues a push. */
async function adoptExistingRows() {
  const now = Date.now();
  await db.transaction("rw", SYNC_TABLES.map((t) => db.table(t)), async (tx) => {
    (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
    for (const name of SYNC_TABLES) {
      await db
        .table(name)
        .filter((r: Row) => r._ts === undefined)
        .modify({ _ts: now });
    }
  });
  kv.set(DIRTY_KEY, String(now));
}

/**
 * Starts syncing: with no code, creates a new vault (first device); with a code, joins an
 * existing one, which must already exist so a typo can't silently start an empty vault.
 */
export async function enableSync(code?: string): Promise<string> {
  const normalized = normalizeCode(code ?? newSyncCode());
  if (!normalized) throw new Error("That sync code isn't valid. It's 20 letters and numbers.");
  const keys = await deriveKeys(normalized);
  if (code) {
    const res = await api("GET", keys, "state");
    if (res.status === 204 || res.status === 404) throw new Error("No synced data found for that code. Check it and try again.");
    if (!res.ok) throw new Error(`Couldn't reach sync (${res.status}).`);
  }
  saveState({ code: formatCode(normalized), etag: null, lastSync: null, uploaded: [] });
  await adoptExistingRows();
  setStatus({ enabled: true, phase: "idle", error: undefined });
  await syncNow();
  if (status.phase === "error") {
    const error = status.error;
    disableSync();
    throw new Error(error);
  }
  return formatCode(normalized);
}

export function disableSync(): void {
  kv.del(STATE_KEY);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  keyCache = null;
  setStatus({ enabled: false, phase: "idle", lastSync: null, error: undefined });
}

/** Wires sync to app lifecycle: on start, on focus, when going online, and every few minutes. */
export function startSyncLoop(): void {
  if (typeof document === "undefined") return;
  let lastFocusSync = 0;
  const maybe = () => {
    if (!loadState() || document.visibilityState !== "visible") return;
    if (Date.now() - lastFocusSync < 20_000) return;
    lastFocusSync = Date.now();
    void syncNow();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") maybe();
    else if (loadState() && dirtyStamp()) void syncNow(); // best effort before the app is suspended
  });
  window.addEventListener("online", maybe);
  setInterval(maybe, 3 * 60_000);
  maybe();
}

/** Test hooks: swap per-device sync state when simulating several devices in one process. */
export const __test = {
  getState: loadState,
  setState: (st: SyncState | null) => (st ? saveState(st) : kv.del(STATE_KEY)),
  dirty: dirtyStamp,
  setDirty: (v: string | null) => (v ? kv.set(DIRTY_KEY, v) : kv.del(DIRTY_KEY)),
  /** Writes without change tracking, as if the data came from elsewhere. */
  untracked: (fn: () => Promise<void>) =>
    db.transaction("rw", [...SYNC_TABLES.map((t) => db.table(t)), db.tombstones], async (tx) => {
      (tx as unknown as Record<symbol, boolean>)[REMOTE] = true;
      await fn();
    }),
};
