import { describe, expect, it } from "vitest";
import { isDatabaseWritable, openDatabase } from "./database.js";

describe("openDatabase", () => {
  it("应用外键与忙等窗口", () => {
    const db = openDatabase(":memory:");

    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    db.close();
  });
});

describe("isDatabaseWritable", () => {
  it("可写库返回 true", () => {
    const db = openDatabase(":memory:");
    expect(isDatabaseWritable(db)).toBe(true);
    db.close();
  });

  it("库已关闭返回 false", () => {
    const db = openDatabase(":memory:");
    db.close();
    expect(isDatabaseWritable(db)).toBe(false);
  });
});
