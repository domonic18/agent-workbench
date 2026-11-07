import { describe, expect, it } from "vitest";
import { parseBearer } from "./bearer.js";

describe("parseBearer", () => {
  it("解析 Bearer <id>.<secret>,按第一个点切分", () => {
    expect(parseBearer("Bearer agt_a.secret.with.dot")).toEqual({
      id: "agt_a",
      secret: "secret.with.dot",
    });
    expect(parseBearer("bearer  agt_a.secret")).toEqual({ id: "agt_a", secret: "secret" });
  });

  it("缺失 / 缺分隔符 / 空段一律 undefined", () => {
    expect(parseBearer(undefined)).toBeUndefined();
    expect(parseBearer("Basic abc")).toBeUndefined();
    expect(parseBearer("Bearer agt_a")).toBeUndefined();
    expect(parseBearer("Bearer .secret")).toBeUndefined();
    expect(parseBearer("Bearer agt_a.")).toBeUndefined();
  });
});
