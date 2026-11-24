// Names can come from component props, category/status mappings, service-job tuples and preview arrays.
// Keep all stand-alone string values that the reference font recognises, including those outside JSX.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));

export function symbolCandidates() {
  const names = new Set();
  function visit(node) {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
      const text = node.text.trim();
      if (/^[a-z0-9_]+$/.test(text)) names.add(text);
    }
    ts.forEachChild(node, visit);
  }

  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "generated") scan(path);
      } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        visit(ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest));
      }
    }
  }
  scan(sourceRoot);
  return [...names].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(symbolCandidates()));
}
