import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(ts|tsx)$/.test(name)
        ? [path]
        : [];
  });
}

describe("frontend architecture boundaries", () => {
  it("keeps removed duplicate models and page-local workflow state out of the tree", () => {
    const removed = [
      "app/adapters/index.ts",
      "entities/task/index.ts",
      "pages/workflow-editor/state.ts",
      "pages/workflow-editor/types.ts",
    ];

    expect(removed.filter((path) => existsSync(join(SRC, path)))).toEqual([]);
  });

  it("keeps shared independent from Windup business layers", () => {
    const violations = sourceFiles(join(SRC, "shared")).filter((path) => {
      const source = readFileSync(path, "utf8");
      return /from ['"]@\/(app|pages|features|entities)\b/.test(source);
    });

    expect(violations.map((path) => relative(SRC, path))).toEqual([]);
  });

  it("keeps transport calls behind shared api and entity adapters", () => {
    const violations = sourceFiles(join(SRC, "pages")).filter((path) =>
      /\bfetch\s*\(/.test(readFileSync(path, "utf8")),
    );

    expect(violations.map((path) => relative(SRC, path))).toEqual([]);
  });

  it("keeps reusable features independent from page implementations", () => {
    const violations = sourceFiles(join(SRC, "features")).filter((path) =>
      /from ['"]@\/pages\b/.test(readFileSync(path, "utf8")),
    );

    expect(violations.map((path) => relative(SRC, path))).toEqual([]);
  });
});
