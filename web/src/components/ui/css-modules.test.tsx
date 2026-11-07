import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CSS Module 类名守门测试
 *
 * vitest 没开 `css: true`，`styles.X` 在测试里恒为 undefined，类名拼错不会报错，
 * 只会在浏览器里静默失效（`.emptyIcon` 就这样漏过一轮）。这里直接读源码比对：
 * 组件引用的 styles.X 必须在对应 .module.css 里真的有这条规则。
 */

const SRC_ROOT = resolve(import.meta.dirname, "../..");

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, ext));
    } else if (entry.endsWith(ext) && !entry.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

/** 取选择器里出现的类名；声明块内的值不算 */
function cssClassNames(css: string): Set<string> {
  const names = new Set<string>();
  // 栈顶模式：rules = 期待选择器（顶层与 @media 内），decl = 期待声明
  const stack: { mode: "rules" | "decl" }[] = [];
  let mode: "rules" | "decl" = "rules";
  let buffer = "";

  const flushSelector = (selector: string): void => {
    for (const match of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      const name = match[1];
      if (name !== undefined) {
        names.add(name);
      }
    }
  };

  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (char === "{") {
      const prelude = buffer;
      buffer = "";
      const atRule = /^\s*@([\w-]+)/.exec(prelude);
      if (atRule === null) {
        flushSelector(prelude);
        stack.push({ mode: "decl" });
        mode = "decl";
        continue;
      }
      // @media / @supports 内部仍是规则列表，其余按声明块处理
      const inner = ["media", "supports", "container", "layer"].includes(atRule[1] ?? "")
        ? "rules"
        : "decl";
      stack.push({ mode: inner });
      mode = inner;
      continue;
    }
    if (char === "}") {
      buffer = "";
      stack.pop();
      mode = stack[stack.length - 1]?.mode ?? "rules";
      continue;
    }
    if (char === ";" && mode === "decl") {
      buffer = "";
      continue;
    }
    buffer += char;
  }
  return names;
}

/** 模块自己定义的类名，外加 `composes` 从别处引进来的类名 */
function definedNames(cssPath: string, seen = new Set<string>()): Set<string> {
  if (seen.has(cssPath)) {
    return new Set();
  }
  seen.add(cssPath);
  const css = readFileSync(cssPath, "utf8");
  const names = cssClassNames(css);
  for (const match of css.matchAll(/composes:\s*([^;]+);/g)) {
    const parts = (match[1] ?? "").split(/\s+from\s+/);
    const local = parts[0]?.trim();
    const source = parts[1];
    if (local === undefined || local === "") {
      continue;
    }
    names.add(local);
    if (source === undefined) {
      continue;
    }
    const imported = resolve(dirname(cssPath), source.trim().replace(/^["']|["']$/g, ""));
    for (const name of definedNames(imported, seen)) {
      names.add(name);
    }
  }
  return names;
}

interface Reference {
  file: string;
  className: string;
  cssFile: string;
}

function collectReferences(): Reference[] {
  const references: Reference[] = [];
  for (const file of walk(SRC_ROOT, ".tsx")) {
    const source = readFileSync(file, "utf8");
    const imports = source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+"([^"]+\.module\.css)"/g);
    for (const match of imports) {
      const alias = match[1];
      const specifier = match[2];
      if (alias === undefined || specifier === undefined) {
        continue;
      }
      const cssFile = resolve(dirname(file), specifier);
      const pattern = new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)`, "g");
      for (const hit of source.matchAll(pattern)) {
        const className = hit[1];
        if (className === undefined) {
          continue;
        }
        references.push({ file, className, cssFile });
      }
    }
  }
  return references;
}

describe("CSS Module 类名守门", () => {
  it("组件引用的 styles.X 在对应 module.css 里有定义", () => {
    const cache = new Map<string, Set<string>>();
    const missing = collectReferences()
      .filter((reference) => {
        let names = cache.get(reference.cssFile);
        if (names === undefined) {
          names = definedNames(reference.cssFile);
          cache.set(reference.cssFile, names);
        }
        return !names.has(reference.className);
      })
      .map((reference) => `${reference.file} → ${reference.className}`);

    expect([...new Set(missing)]).toEqual([]);
  });
});
