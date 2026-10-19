// Gemini's JSON mode sometimes writes LaTeX with a single backslash. Where that backslash plus the
// next letter is a valid JSON escape (\b \f \n \r \t), JSON.parse quietly turns `\text` into a tab
// followed by "ext", `\boldsymbol` into a backspace and "oldsymbol", and so on, and KaTeX then
// shows the whole formula as red source. Other letters (`\alpha`, `\ce`) are invalid escapes, so
// constrained decoding forces a proper `\\` for those and they arrive intact.

/** Inside math, a tab, backspace, form feed or carriage return before a letter is always an eaten backslash. */
const EATEN: Record<string, string> = { "\b": "b", "\f": "f", "\t": "t", "\r": "r", "\n": "n" };

// A newline before a letter is often real (display math), so it only counts when it spells a
// command. `\ne` and `\ni` are left out: "$$\ne^x$$" is more likely e^x on its own line.
const N_COMMANDS = new Set([
  "nabla", "natural", "ncong", "nearrow", "neg", "neq", "newline", "nexists", "ngeq", "nleq", "nleftarrow",
  "nLeftarrow", "nmid", "nolimits", "not", "notin", "nparallel", "nrightarrow", "nRightarrow", "nsim",
  "nsubseteq", "nsupseteq", "nu", "nwarrow",
]);

// `\$` is a literal dollar, then display math, then inline math (the spans remark-math renders).
const MATH = /\\\$|\$\$[\s\S]*?\$\$|\$(?:\\[\s\S]|[^\\$])+?\$/g;

/** Puts back backslashes that JSON escapes ate out of LaTeX. Text outside math is left alone. */
export function repairLatex(s: string): string {
  if (!/[\b\f\t\r\n]/.test(s)) return s;
  return s.replace(MATH, (span) =>
    span.startsWith("\\")
      ? span
      : span.replace(/([\b\f\t\r\n])([a-zA-Z]+)/g, (m, ch: string, word: string) =>
          ch === "\n" && !N_COMMANDS.has(`n${word}`) ? m : `\\${EATEN[ch]}${word}`,
        ),
  );
}
