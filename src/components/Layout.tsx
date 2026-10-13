import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, CloudAlert, CloudCheck, Plus, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { db } from "../lib/db";
import { formatUsd } from "../lib/pricing";
import { useSettings } from "../lib/settings";
import { monthStart } from "../lib/usage";
import { useSyncStatus } from "../lib/sync";

function useTheme() {
  const { theme } = useSettings();
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

export function Layout({ children }: { children: ReactNode }) {
  useTheme();
  const sync = useSyncStatus();
  const spent = useLiveQuery(async () => {
    const rows = await db.usage.where("at").aboveOrEqual(monthStart()).toArray();
    return rows.reduce((n, r) => n + r.costUsd, 0);
  });

  const navItem = ({ isActive }: { isActive: boolean }) =>
    clsx(
      "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition",
      isActive ? "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200" : "text-muted hover:text-[var(--text)]",
    );

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-theme bg-[var(--bg)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <Link to="/" className="mr-2 flex items-center gap-2 font-bold tracking-tight">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="size-7" />
            <span className="text-lg">Mnemo</span>
          </Link>
          <nav className="flex flex-1 items-center gap-1">
            <NavLink to="/" end className={navItem}>
              <BookOpen className="size-4" />
              <span className="hidden sm:inline">Kits</span>
            </NavLink>
            <NavLink to="/new" className={navItem}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">New kit</span>
            </NavLink>
          </nav>
          {sync.enabled && (
            <NavLink to="/settings" className="rounded-lg p-2 text-muted hover:text-[var(--text)]" title={sync.phase === "error" ? `Sync problem: ${sync.error}` : sync.phase === "syncing" ? "Syncing" : "Synced"}>
              {sync.phase === "syncing" ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : sync.phase === "error" ? (
                <CloudAlert className="size-4 text-rose-600" />
              ) : (
                <CloudCheck className="size-4" />
              )}
            </NavLink>
          )}
          <NavLink to="/settings" className={navItem} title="Settings and API usage">
            <span className="tabular-nums">{formatUsd(spent ?? 0)}</span>
            <SettingsIcon className="size-4" />
          </NavLink>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-24">{children}</main>
    </div>
  );
}
