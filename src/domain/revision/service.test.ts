import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { insertMachine } from "../../store/repositories/machine.js";
import { createRevisionService } from "./service.js";

const AT = 1_700_000_000_000;

describe("revision 服务", () => {
  let db: Db;

  beforeEach(async () => {
    db = await openDatabase();
  });

  it("未产生变更的作用域水位为 0", async () => {
    const service = createRevisionService({ db });
    expect(await service.snapshot(["overview", "task:tsk_1"])).toEqual([
      { scope: "overview", revision: 0 },
      { scope: "task:tsk_1", revision: 0 },
    ]);
  });

  it("投影表变更后按作用域返回新水位", async () => {
    await insertMachine(db, {
      id: "m1",
      hostname: "host",
      os: "darwin",
      collectorVersion: "1.0.0",
      collectorSecretHash: "h",
      createdAt: AT,
    });
    await db.run("UPDATE machine SET last_seen_at = ? WHERE id = 'm1'", AT);

    const service = createRevisionService({ db });
    expect(await service.snapshot(["overview"])).toEqual([{ scope: "overview", revision: 1 }]);
  });
});
