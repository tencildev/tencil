import { describe, expect, it } from "vitest";
import { projectPath, resolvePath } from "./context.ts";

describe("projectPath", () => {
  it.each([
    ["http://localhost:5173/src/components/Card.tsx?t=123", "src/components/Card.tsx"],
    ["http://localhost:5173/@fs/Users/me/app/src/App.tsx", "/Users/me/app/src/App.tsx"],
    ["webpack-internal:///./src/App.tsx", "src/App.tsx"],
    ["webpack-internal:///(app-pages-browser)/./app/page.tsx", "app/page.tsx"],
    ["turbopack:///[project]/app/page.tsx", "[project]/app/page.tsx"],
    ["file:///Users/me/app/src/App.tsx", "/Users/me/app/src/App.tsx"],
    ["/src/App.tsx", "src/App.tsx"],
  ])("%s → %s", (input, expected) => {
    expect(projectPath(input)).toBe(expected);
  });
});

describe("resolvePath", () => {
  it("restores the directory from the served path", () => {
    expect(resolvePath("Hero.tsx", "src/components/Hero.tsx")).toBe("src/components/Hero.tsx");
  });
  it("keeps symbolicated paths that already have a directory", () => {
    expect(resolvePath("app/page.tsx", "chunks/app.js")).toBe("app/page.tsx");
  });
  it("ignores unrelated raw paths", () => {
    expect(resolvePath("Hero.tsx", "chunks/main.js")).toBe("Hero.tsx");
  });
});
