// Mnemo sync endpoint (Vercel Function). Stores opaque, client-encrypted blobs; it never sees a
// key or plaintext. A vault id is a SHA-256-sized value derived from the user's sync code.
//
//   GET  /api/sync?vault=<64 hex>&name=state|src-<uuid>   [If-None-Match]  -> 200 bytes | 304 | 204 (none)
//   PUT  /api/sync?vault=<64 hex>&name=...                [If-Match]       -> 200 {etag} | 412
//
// PUT on "state" without If-Match only creates; with If-Match it's a compare-and-swap, so two
// devices saving at once can't silently overwrite each other (the loser re-pulls and merges).
import { BlobPreconditionFailedError, get, head, put } from "@vercel/blob";

const VAULT = /^[0-9a-f]{64}$/;
const NAME = /^(state|src-[0-9a-f-]{36})$/;
// Vercel Functions accept request bodies up to 4.5 MB.
const MAX_BYTES = 4 * 1024 * 1024;
// no-transform: the payload is already gzipped and encrypted, so CDN compression only wastes time.
const NO_STORE = { "Cache-Control": "no-store, no-transform" };

/**
 * Vercel's CDN turns ETags weak (W/"…") on the way out, which would never match on the way back
 * in. Send the exact value in X-Etag too, and accept either form from clients.
 */
const strong = (etag: string | null) => etag?.replace(/^W\//, "") || undefined;
const tagHeaders = (etag: string) => ({ ETag: etag, "X-Etag": etag });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const vault = url.searchParams.get("vault") ?? "";
    const name = url.searchParams.get("name") ?? "";
    if (!VAULT.test(vault) || !NAME.test(name)) return json({ error: "Bad vault or name." }, 400);
    const pathname = `vaults/${vault}/${name}.bin`;

    try {
      if (request.method === "GET") {
        const result = await get(pathname, {
          access: "private",
          useCache: false,
          ifNoneMatch: strong(request.headers.get("if-none-match")),
        });
        // 204 rather than 404 for "nothing stored yet": it's an expected answer, not an error.
        if (!result) return new Response(null, { status: 204, headers: NO_STORE });
        if (result.statusCode === 304) return new Response(null, { status: 304, headers: { ...NO_STORE, ...tagHeaders(result.blob.etag) } });
        return new Response(result.stream, {
          headers: { ...NO_STORE, "Content-Type": "application/octet-stream", ...tagHeaders(result.blob.etag) },
        });
      }

      if (request.method === "PUT") {
        const body = new Uint8Array(await request.arrayBuffer());
        if (body.byteLength === 0) return json({ error: "Empty body." }, 400);
        if (body.byteLength > MAX_BYTES) return json({ error: "Too large." }, 413);
        const ifMatch = strong(request.headers.get("if-match"));
        // Source texts never change, so overwriting one is harmless; state needs create-or-CAS.
        const isState = name === "state";
        try {
          const blob = await put(pathname, Buffer.from(body), {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: !isState || !!ifMatch,
            ifMatch: isState ? ifMatch : undefined,
            contentType: "application/octet-stream",
          });
          return json({ etag: blob.etag });
        } catch (err) {
          if (err instanceof BlobPreconditionFailedError) return json({ error: "Changed since you last read it." }, 412);
          // Create-only write lost a race: someone else created the state first.
          if (isState && !ifMatch && (await head(pathname).catch(() => null))) return json({ error: "Already exists." }, 412);
          throw err;
        }
      }

      return json({ error: "Method not allowed." }, 405);
    } catch (err) {
      console.error("sync error", err);
      return json({ error: "Storage error." }, 500);
    }
  },
};
