import clsx from "clsx";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-300 text-brand-900 hover:bg-brand-400 shadow-sm shadow-brand-900/10 disabled:bg-brand-200 dark:bg-brand-500 dark:text-white dark:hover:bg-brand-400",
  secondary: "surface hover:bg-[var(--surface-2)] text-[var(--text)]",
  ghost: "hover:bg-[var(--surface-2)] text-[var(--text)]",
  danger: "bg-blush-200 text-blush-700 hover:bg-blush-500 hover:text-white",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60",
        size === "sm" && "px-3 py-1.5 text-sm",
        size === "md" && "px-4 py-2.5 text-sm",
        size === "lg" && "px-5 py-3 text-base",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = "primary",
  className,
  children,
}: {
  to: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition active:scale-[0.97]",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={clsx("surface rounded-[var(--radius-card)] shadow-sm shadow-brand-900/5", className)}>
      {children}
    </div>
  );
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={clsx("flex items-center gap-3 text-muted", className)}>
      <LoaderCircle className="size-5 animate-spin text-brand-600" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-700 dark:border-blush-700/60 dark:bg-blush-700/20 dark:text-blush-200">
      <span>{error}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 font-semibold underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Progress({ value, className, tone = "brand" }: { value: number; className?: string; tone?: "brand" | "green" | "amber" | "rose" }) {
  const color = { brand: "bg-brand-400", green: "bg-emerald-400", amber: "bg-butter-500", rose: "bg-blush-500" }[tone];
  return (
    <div className={clsx("h-2 overflow-hidden rounded-full surface-2", className)}>
      <div className={clsx("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "brand" | "green" | "amber" | "rose"; className?: string }) {
  const tones = {
    neutral: "surface-2 text-muted",
    brand: "bg-brand-100 text-brand-800 dark:bg-brand-900/60 dark:text-brand-200",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    amber: "bg-butter-100 text-butter-800 dark:bg-butter-800/40 dark:text-butter-200",
    rose: "bg-blush-100 text-blush-700 dark:bg-blush-700/40 dark:text-blush-200",
  };
  return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="surface animate-pop max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-5 sm:rounded-[var(--radius-card)]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-[var(--surface-2)]" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link to={back} className="mb-1 inline-block text-sm text-muted hover:text-brand-600">
            ← Back
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-theme px-6 py-12 text-center">
      <div className="text-brand-600">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

/** `group` is for a set of buttons: a <label> around buttons would name and click the first one. */
export function Field({ label, hint, group, children }: { label: string; hint?: ReactNode; group?: boolean; children: ReactNode }) {
  const body = (
    <>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </>
  );
  return group ? (
    <div role="group" aria-label={label} className="block">
      {body}
    </div>
  ) : (
    <label className="block">{body}</label>
  );
}

export const inputClass =
  "w-full rounded-xl surface px-3 py-2.5 text-sm outline-none transition placeholder:text-[var(--muted)] focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition",
            value === o.value ? "surface text-[var(--text)] shadow-sm" : "text-muted hover:text-[var(--text)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function MissingKit() {
  return (
    <div className="space-y-4">
      <p>This kit doesn't exist (it may have been deleted).</p>
      <LinkButton to="/">Back to kits</LinkButton>
    </div>
  );
}
