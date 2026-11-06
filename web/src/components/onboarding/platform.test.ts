import { describe, expect, it } from "vitest";
import { artifactKeyOf } from "./platform.js";

describe("产物平台识别", () => {
  it("按文件名前缀给出平台键", () => {
    expect(artifactKeyOf("aw-node-macos-arm64")).toBe("macos-arm64");
    expect(artifactKeyOf("aw-node-macos-x64")).toBe("macos-x64");
  });

  it("不认识的文件名不给平台键", () => {
    expect(artifactKeyOf("aw-node-linux-amd64")).toBeNull();
    expect(artifactKeyOf("checksums.txt")).toBeNull();
  });
});
