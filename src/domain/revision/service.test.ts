import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../../store/database.js";
import { runMigrations } from "../../store/migrator.js";
import { insertMachine } from "../../store/repositories/identity.js";
import { createRevisionService } from "./service.js";

const AT = 1_700_000_000_000;

describe("revision 服务", () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(":memory:");
    runMigrations(db);
  });

  it("未产生变更的作用域水位为 0", () => {
    const service = createRevisionService({ db });
    expect(service.snapshot(["overview", "task:tsk_1"])).toEqual([
      { scope: "overview", revision: 0 },
      { scope: "task:tsk_1", revision: 0 },
    ]);
  });

  it("投影表变更后按作用域返回新水位", () => {
    insertMachine(db, {
      id: "m1",
      hostname: "host",
      os: "darwin",
      collectorVersion: "1.0.0",
      collectorSecretHash: "h",
      createdAt: AT,
    });
    db.prepare("UPDATE machine SET last_seen_at = ? WHERE id = 'm1'").run(AT);

    const service = createRevisionService({ db });
    expect(service.snapshot(["overview"])).toEqual([{ scope: "overview", revision: 1 }]);
  });
});
