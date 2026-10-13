import { Check, Cloud, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { disableSync, enableSync, syncCode, syncNow, useSyncStatus } from "../lib/sync";
import { Button, Card, ErrorBox, inputClass } from "./ui";

export function timeAgo(t: number | null): string {
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export function SyncCard() {
  const status = useSyncStatus();
  const [joining, setJoining] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = syncCode();

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setJoining(false);
      setInput("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Cloud className="size-4 text-brand-600" /> Sync across devices
        </h2>
        <p className="mt-1 text-sm text-muted">
          Keeps kits, progress and settings (including the API key) the same on every device. Everything is encrypted on this device with your sync code before it's uploaded, so the
          server can't read it. Podcast audio stays on the device that made it.
        </p>
      </div>

      {status.enabled && code ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className={status.phase === "error" ? "text-rose-600" : "text-muted"}>
              {status.phase === "syncing" ? "Syncing…" : status.phase === "error" ? "Sync problem" : `Synced ${timeAgo(status.lastSync)}`}
            </span>
            <Button variant="secondary" size="sm" onClick={() => syncNow()} loading={status.phase === "syncing"}>
              <RefreshCw className="size-4" /> Sync now
            </Button>
          </div>
          {status.phase === "error" && status.error && <ErrorBox error={status.error} />}
          <div className="rounded-xl surface-2 p-3">
            <div className="mb-1 text-xs font-medium text-muted">Sync code: enter this on her other devices</div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 font-mono text-base tracking-wider">{show ? code : code.replace(/[0-9A-Z]/g, "•")}</code>
              <Button variant="ghost" size="sm" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide code" : "Show code"}>
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} Copy
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">Anyone with this code can read and change the synced data. Keep it like a password.</p>
          </div>
          <button
            className="text-sm text-muted hover:text-rose-600"
            onClick={() => confirm("Stop syncing on this device? Its data stays here; other devices keep syncing.") && disableSync()}
          >
            Turn off sync on this device
          </button>
        </>
      ) : joining ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => enableSync(input));
          }}
        >
          <input
            autoFocus
            className={`${inputClass} font-mono tracking-wider uppercase`}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
          <p className="text-xs text-muted">Kits already on this device are kept and merged in.</p>
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={!input.trim()}>
              Join
            </Button>
            <Button type="button" variant="ghost" onClick={() => setJoining(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run(() => enableSync())} loading={busy}>
            Turn on sync (first device)
          </Button>
          <Button variant="secondary" onClick={() => setJoining(true)}>
            I have a sync code
          </Button>
        </div>
      )}
      {error && <ErrorBox error={error} />}
    </Card>
  );
}
