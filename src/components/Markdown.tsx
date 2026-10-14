import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={clsx(
        "prose prose-slate max-w-none dark:prose-invert prose-headings:tracking-tight prose-a:text-brand-600 prose-table:text-sm prose-th:text-left",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** For short strings (questions, options) where block-level prose styling would be too much. */
export function InlineMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={clsx("prose prose-slate max-w-none dark:prose-invert prose-p:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
