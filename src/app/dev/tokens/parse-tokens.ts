// Reads the custom properties out of src/styles/tokens.css so /dev/tokens always shows every token,
// including ones added later. Pure function: give it the CSS text, get the tokens back.

export type TokenKind = "colour" | "type" | "space" | "radius" | "shadow" | "size" | "layer" | "motion" | "other";

export type Token = { name: string; value: string; note?: string };
export type TokenSection = { number: number; title: string; kind: TokenKind; tokens: Token[] };
export type ParsedTokens = {
  sections: TokenSection[];
  /** Overrides per mode, e.g. modes.trade["--trade-action"] = { name, value: "var(--trade-hivis)", note }. */
  modes: Record<string, Record<string, Token>>;
};

const BLOCK = /(:root|\[data-mode="([\w-]+)"\])\s*\{([^}]*)\}/g;
const ITEM =
  /\/\*\s*-{2,}\s*(\d+)\.\s*([^*]+?)\s*-*\s*\*\/|(--[\w-]+)\s*:\s*([^;]+);(?:[ \t]*\/\*\s*([^*]*?)\s*\*\/)?/g;

export function kindForSection(title: string): TokenKind {
  const t = title.toLowerCase();
  if (/^type\b/.test(t)) return "type";
  if (/palette|^text|lines|feedback|^mode/.test(t)) return "colour";
  if (/^space/.test(t)) return "space";
  if (/^shape/.test(t)) return "radius";
  if (/^elevation/.test(t)) return "shadow";
  if (/^sizing/.test(t)) return "size";
  if (/^layers/.test(t)) return "layer";
  if (/^motion/.test(t)) return "motion";
  return "other";
}

export function parseTokens(css: string): ParsedTokens {
  const sections: TokenSection[] = [];
  const modes: ParsedTokens["modes"] = {};

  for (const [, selector, mode, body] of css.matchAll(BLOCK)) {
    if (selector === ":root") {
      let current: TokenSection | undefined;
      for (const [, number, title, name, value, note] of body.matchAll(ITEM)) {
        if (title) {
          const clean = title.trim().replace(/\s*-+$/, "");
          current = { number: Number(number), title: clean, kind: kindForSection(clean), tokens: [] };
          sections.push(current);
          continue;
        }
        if (!current) {
          current = { number: 0, title: "Other", kind: "other", tokens: [] };
          sections.push(current);
        }
        current.tokens.push({ name, value: value.trim(), ...(note ? { note } : {}) });
      }
    } else if (mode) {
      const overrides: Record<string, Token> = {};
      for (const [, , , name, value, note] of body.matchAll(ITEM)) {
        if (name) overrides[name] = { name, value: value.trim(), ...(note ? { note } : {}) };
      }
      modes[mode] = { ...modes[mode], ...overrides };
    }
  }

  return { sections, modes };
}
