import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdentityError } from "../identity/errors.js";
import { openDatabase, type Db } from "../../store/database.js";
import { insertAgent, updateAgentAllowedTargets } from "../../store/repositories/agent.js";
import { parseJsonStringArray } from "../../store/json.js";
import { createGroupService } from "./service.js";

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

describe("委派目标组", () => {
  let db: Db;
  let service: ReturnType<typeof createGroupService>;
  let seq = 0;

  beforeEach(async () => {
    db = await openDatabase();
    seq = 0;
    service = createGroupService({
      db,
      now: () => AT,
      newGroupId: () => `grp_${++seq}`,
    });
    await addAgent(db, "agt_a");
    await addAgent(db, "agt_b");
  });

  afterEach(async () => {
    await db.close();
  });

  it("建组带成员,列表能读回来", async () => {
    const group = await service.create({ name: "CC 三兄弟", memberIds: ["agt_a", "agt_b"] });

    expect(group.id).toBe("grp_1");
    expect(group.memberIds.sort()).toEqual(["agt_a", "agt_b"]);

    const groups = await service.list();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("CC 三兄弟");
  });

  it("组成员必须是已登记的 Agent", async () => {
    await expect(service.create({ name: "空组", memberIds: ["agt_不存在"] })).rejects.toThrow(
      /组成员不存在/,
    );
  });

  it("组名为空拒绝", async () => {
    await expect(service.create({ name: "   " })).rejects.toBeInstanceOf(IdentityError);
  });

  it("改名与成员整包覆盖", async () => {
    const group = await service.create({ name: "旧名", memberIds: ["agt_a"] });

    const updated = await service.update(group.id, { name: "新名", memberIds: ["agt_b"] });

    expect(updated.name).toBe("新名");
    expect(updated.memberIds).toEqual(["agt_b"]);
  });

  it("删组时清掉各 Agent 白名单里的这个组 id", async () => {
    const group = await service.create({ name: "临时组", memberIds: [] });
    await updateAgentAllowedTargets(db, "agt_a", JSON.stringify([group.id, "agt_b"]), AT);

    await service.remove(group.id);

    const row = await db.get(
      'SELECT allowed_targets_json AS "targets" FROM agent WHERE id = ?',
      "agt_a",
    );
    expect(parseJsonStringArray((row as { targets: string }).targets)).toEqual(["agt_b"]);
  });

  it("删不存在的组报 404 语义的错", async () => {
    await expect(service.remove("grp_不存在")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
