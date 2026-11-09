import { describe, expect, it } from "vitest";
import { hashSecret, newSecret, verifySecret } from "./secrets.js";

describe("secrets", () => {
  it("哈希自描述且可往返校验,同值不同盐不复用哈希", async () => {
    const stored = await hashSecret("s3cret");
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifySecret("s3cret", stored)).toBe(true);
    expect(await verifySecret("s3cret", await hashSecret("s3cret"))).toBe(true);
    expect(await hashSecret("s3cret")).not.toBe(stored);
  });

  it("不匹配返回 false", async () => {
    const stored = await hashSecret("right");
    expect(await verifySecret("wrong", stored)).toBe(false);
    expect(await verifySecret("", stored)).toBe(false);
  });

  it("坏格式一律拒绝,不抛异常", async () => {
    for (const stored of [
      "",
      "plaintext",
      "bcrypt$1$2$3$4$5",
      "scrypt$0$8$1$abcd$abcd",
      "scrypt$16384$8$1$zz$abcd",
      "scrypt$16384$8$1$abcd",
    ]) {
      expect(await verifySecret("x", stored)).toBe(false);
    }
  });

  it("newSecret 每次不同且不含分隔符", () => {
    const a = newSecret();
    const b = newSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
