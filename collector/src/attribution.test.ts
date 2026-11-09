import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildAttributionIndex,
  loadAttributionIndex,
  overlayAttributionIndex,
  projectFromSessionFile,
} from "./attribution.js";

const UUID_A = "11111111-2222-3333-4444-555555555555";
const UUID_B = "66666666-7777-8888-9999-000000000000";

describe("cc-connect 归因", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aw-attribution-"));
    mkdirSync(join(dir, "sessions"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("项目名取文件名中最后一个 _<8hex> 之前的部分", () => {
    expect(projectFromSessionFile("lokta-acore-manager_15d63632.json")).toBe(
      "lokta-acore-manager",
    );
    expect(projectFromSessionFile("no-suffix.json")).toBeNull();
    expect(projectFromSessionFile("agent-workbench_6e1e3cc3.json")).toBe("agent-workbench");
  });

  it("当前与历史 session id 都参与归因", () => {
    writeFileSync(
      join(dir, "sessions", "proj-a_1234abcd.json"),
      JSON.stringify({
        sessions: {
          s1: { agent_session_id: UUID_A, past_agent_session_ids: [UUID_B] },
        },
      }),
    );
    const index = loadAttributionIndex(dir);
    expect(index.resolve(UUID_A)).toEqual(["proj-a"]);
    expect(index.resolve(UUID_B.toUpperCase())).toEqual(["proj-a"]);
    expect(index.resolve("00000000-0000-0000-0000-000000000000")).toEqual([]);
  });

  it("同一 session 命中多个项目时返回全部,由调用方判定歧义", () => {
    writeFileSync(
      join(dir, "sessions", "proj-a_1234abcd.json"),
      JSON.stringify({ sessions: { s1: { agent_session_id: UUID_A } } }),
    );
    writeFileSync(
      join(dir, "sessions", "proj-b_deadbeef.json"),
      JSON.stringify({ sessions: { s1: { agent_session_id: UUID_A } } }),
    );
    const index = loadAttributionIndex(dir);
    expect(index.resolve(UUID_A)).toEqual(["proj-a", "proj-b"]);
    expect(index.projects()).toEqual(["proj-a", "proj-b"]);
  });

  it("损坏的档案被跳过,不抛错", () => {
    writeFileSync(join(dir, "sessions", "broken_1234abcd.json"), "{not json");
    writeFileSync(
      join(dir, "sessions", "proj-a_1234abcd.json"),
      JSON.stringify({ sessions: { s1: { agent_session_id: UUID_A } } }),
    );
    const index = loadAttributionIndex(dir);
    expect(index.sessionCount()).toBe(1);
  });

  it("空索引 resolve 返回空数组", () => {
    const index = buildAttributionIndex(new Map());
    expect(index.resolve(UUID_A)).toEqual([]);
  });
});

describe("本地登记叠加(派发会话归因)", () => {
  it("extra 取活引用:登记后不重建索引也立即命中,不留档 3 跳 EOF 的窗口", () => {
    const extra = new Map<string, ReadonlySet<string>>();
    const index = overlayAttributionIndex(buildAttributionIndex(new Map()), extra);
    expect(index.resolve(UUID_A)).toEqual([]);
    extra.set(UUID_A, new Set(["p-dispatch"]));
    expect(index.resolve(UUID_A)).toEqual(["p-dispatch"]);
  });

  it("与 cc-connect 索引合并,两边都命中时取并集", () => {
    const base = buildAttributionIndex(new Map([[UUID_A, new Set(["proj-a"])]]));
    const index = overlayAttributionIndex(
      base,
      new Map([[UUID_A, new Set(["p-dispatch"])]]),
    );
    expect(index.resolve(UUID_A)).toEqual(["p-dispatch", "proj-a"]);
    expect(index.projects()).toEqual(["p-dispatch", "proj-a"]);
    expect(index.sessionCount()).toBe(2);
  });

  it("未登记的会话照走 base,登记侧大小写不敏感", () => {
    const base = buildAttributionIndex(new Map([[UUID_A, new Set(["proj-a"])]]));
    const index = overlayAttributionIndex(
      base,
      new Map([[UUID_B.toUpperCase(), new Set(["p-dispatch"])]]),
    );
    expect(index.resolve(UUID_A)).toEqual(["proj-a"]);
    expect(index.resolve(UUID_B)).toEqual(["p-dispatch"]);
  });
});
