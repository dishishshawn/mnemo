import { Download } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useJobsRunning } from "../lib/jobs";
import { Button } from "./ui";

/** How often an open app looks for a new version, besides each time it comes back to the foreground. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Home-screen apps (iOS especially) are resumed rather than reloaded, so the browser's own update
 * check, which runs on page loads, almost never happens. This checks whenever the app comes back to
 * the foreground and hourly, then offers the new version here. It never reloads by itself: that
 * would cut off an answer, or a kit being built.
 */
export function UpdateButton() {
  const busy = useJobsRunning();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (document.visibilityState === "visible" && navigator.onLine) registration.update().catch(() => {});
      };
      document.addEventListener("visibilitychange", check);
      setInterval(check, CHECK_EVERY_MS);
    },
  });
  if (!needRefresh) return null;
  return (
    <Button size="xs" onClick={() => updateServiceWorker()} disabled={busy} title={busy ? "Mnemo is still working; update once it's done" : "A new version of Mnemo is ready"}>
      <Download className="hidden size-3.5 sm:block" /> Update
    </Button>
  );
}
