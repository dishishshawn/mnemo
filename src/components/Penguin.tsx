// The study buddy. Eight still poses swapped by mood, with a little CSS motion on top (bob, sway,
// bounce, wobble). No API calls: the images are in public/penguin/ and the animations are in
// index.css, which also honours prefers-reduced-motion.
import clsx from "clsx";
import type { ReactNode } from "react";

export type Mood = "idle" | "thinking" | "reading" | "cheer" | "oops" | "idea" | "listening" | "sleeping";

const SIZES = { xs: "size-8", sm: "size-12", md: "size-20", lg: "size-28", xl: "size-40" } as const;

export function Penguin({ mood = "idle", size = "md", className }: { mood?: Mood; size?: keyof typeof SIZES; className?: string }) {
  return (
    <img
      key={mood}
      src={`${import.meta.env.BASE_URL}penguin/${mood}.png`}
      alt=""
      draggable={false}
      className={clsx("select-none", SIZES[size], `penguin-${mood}`, className)}
    />
  );
}

/** The penguin with a speech bubble beside him. */
export function PenguinSays({ mood, children, size = "md", className }: { mood?: Mood; children: ReactNode; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <Penguin mood={mood} size={size} className="shrink-0" />
      <div className="relative rounded-2xl surface px-3.5 py-2 text-sm leading-snug shadow-sm shadow-brand-900/5">
        <span className="absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rotate-45 border-b-[1.5px] border-l-[1.5px] border-theme bg-[var(--surface)]" aria-hidden />
        {children}
      </div>
    </div>
  );
}
