import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || extname(entry.name) !== ".ts" || entry.name.endsWith(".test.ts")) return [];
    return [path];
  });
}

describe("desktop main error-handling policy", () => {
  it("contains no bare catch clauses or zero-argument Promise catch fallbacks", () => {
    const root = fileURLToPath(new URL(".", import.meta.url));
    const violations: string[] = [];

    for (const path of sourceFiles(root)) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const visit = (node: ts.Node): void => {
        if (ts.isCatchClause(node) && !node.variableDeclaration) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          violations.push(`${path}:${line} bare catch`);
        }
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "catch"
        ) {
          const handler = node.arguments[0];
          if ((handler && ts.isArrowFunction(handler)) || (handler && ts.isFunctionExpression(handler))) {
            if (handler.parameters.length === 0) {
              const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
              violations.push(`${path}:${line} zero-argument Promise catch`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(violations).toEqual([]);
  });
});
