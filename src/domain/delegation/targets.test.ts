import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAgent } from "../../store/repositories/agent.js";
import { insertGroup, setGroupMembers } from "../../store/repositories/agent-group.js";
import { canReachAgent, reachableAgentIds, resolveTargets } from "./targets.js";

const AT = 1_700_000_000_000;

async function addAgent(db: Db, id: string): Promise<void> {
  await insertAgent(db, {
    id,
    machineId: null,
    runtime: "claude_code",
    project: "aw",
    displayName: id,
    secretHash: "h",
    feishuAppId: null,
    allowedTargetsJson: "[]",
    createdAt: AT,
  });
}

describe("委派目标解析", () => {
  let db: Db;

  beforeEach(async () => {
    db = await openDatabase();
    await addAgent(db, "agt_a");
    await addAgent(db, "agt_b");
    await addAgent(db, "agt_c");
    await insertGroup(db, { id: "grp_1", name: "CC 三兄弟", createdAt: AT });
    await setGroupMembers(db, "grp_1", ["agt_b", "agt_c"], AT);
  });

  afterEach(async () => {
    await db.close();
  });

  it("组展开成成员,并标注来自哪个组", async () => {
    const resolved = await resolveTargets(db, ["grp_1"]);

    expect(resolved.map((item) => item.agent.id).sort()).toEqual(["agt_b", "agt_c"]);
    expect(resolved.every((item) => item.viaGroupId === "grp_1")).toBe(true);
    expect(resolved[0]?.viaGroupName).toBe("CC 三兄弟");
  });

  it("直接授权优先于经组可达", async () => {
    const resolved = await resolveTargets(db, ["agt_b", "grp_1"]);

    const direct = resolved.find((item) => item.agent.id === "agt_b");
    expect(direct?.viaGroupId).toBeNull();
  });

  it("组内成员可达,组外不可达", async () => {
    expect(await canReachAgent(db, ["grp_1"], "agt_b")).toBe(true);
    expect(await canReachAgent(db, ["grp_1"], "agt_a")).toBe(false);
    expect(await canReachAgent(db, ["agt_b"], "agt_b")).toBe(true);
  });

  it("可达目标 id 列表已展开(错误回带用)", async () => {
    expect((await reachableAgentIds(db, ["grp_1"])).sort()).toEqual(["agt_b", "agt_c"]);
  });
});
