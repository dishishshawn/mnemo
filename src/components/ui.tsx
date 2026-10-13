import clsx from "clsx";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-sm shadow-brand-900/20 disabled:bg-brand-400",
  secondary: "surface hover:bg-[var(--surface-2)] text-[var(--text)]",
  ghost: "hover:bg-[var(--surface-2)] text-[var(--text)]",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
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
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60",
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
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition active:scale-[0.98]",
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
    <div onClick={onClick} className={clsx("surface rounded-2xl", className)}>
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
    <div className="flex items-start justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
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
  const color = { brand: "bg-brand-600", green: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500" }[tone];
  return (
    <div className={clsx("h-2 overflow-hidden rounded-full surface-2", className)}>
      <div className={clsx("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "brand" | "green" | "amber" | "rose"; className?: string }) {
  const tones = {
    neutral: "surface-2 text-muted",
    brand: "bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    rose: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
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
      <div className="surface animate-pop max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
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
          <Link to={back} className="mb-1 inline-block text-sm text-muted hover:text-brand-700">
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
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-theme px-6 py-12 text-center">
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
