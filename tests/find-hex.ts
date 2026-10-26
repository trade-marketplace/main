// Finds hard-coded hex colours in app code. Used by tests/unit/no-hex.test.ts.
// Comments are ignored (so "#101" in a comment about an issue is fine); strings, template literals, JSX text and
// CSS values are checked.
import ts from "typescript";

export type HexHit = { line: number; match: string };

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;

function hitsIn(text: string, startLine: number): HexHit[] {
  const hits: HexHit[] = [];
  text.split("\n").forEach((lineText, i) => {
    for (const m of lineText.matchAll(HEX)) hits.push({ line: startLine + i, match: m[0] });
  });
  return hits;
}

/** CSS: strip block comments (keeping line breaks so line numbers stay right), then look for hex values. */
export function findHexInCss(css: string): HexHit[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  return hitsIn(withoutComments, 1);
}

/** TS/TSX/JS: parse properly and only look inside string-like tokens, never comments or identifiers. */
export function findHexInScript(source: string, fileName: string): HexHit[] {
  const kind = /\.(tsx|jsx)$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const hits: HexHit[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const start = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      hits.push(...hitsIn(node.getText(file), start));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}
