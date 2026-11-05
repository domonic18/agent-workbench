import type { Db } from "../../store/database.js";
import {
  findAgentById,
  listAgents,
  listMachines,
} from "../../store/repositories/identity.js";
import {
  findAssembly,
  insertAssembly,
  type AssemblyRecord,
} from "../../store/repositories/assembly.js";
import { BootstrapError } from "./errors.js";
import { DEFAULT_BUG_FIX } from "../routing/policy.js";

export { DEFAULT_BUG_FIX };

/** 机器存活判定窗口:与「离线超过 5 分钟标注心跳超时」同口径 */
export const HEARTBEAT_FRESH_MS = 5 * 60_000;

export type PreflightItemKey =
  | "database"
  | "machine"
  | "collection"
  | "mcp"
  | "agent"
  | "roles"
  | "bug_source"
  | "github_ci";

export type PreflightStatus = "ok" | "fail" | "not_configured";

export interface PreflightItem {
  key: PreflightItemKey;
  status: PreflightStatus;
  detail: string;
  hint?: string | undefined;
}

export interface PreflightResult {
  items: PreflightItem[];
  /** 全部可校验项通过才就绪;未配置项只展示,不阻塞(03 §4.0) */
  ready: boolean;
}

const NOT_CONFIGURED_HINT =
  "该集成随业务闭环里程碑上线;现在可先向原 Bug 机器人反馈第一个问题";

function item(
  key: PreflightItemKey,
  status: PreflightStatus,
  detail: string,
  hint?: string,
): PreflightItem {
  return { key, status, detail, ...(hint === undefined ? {} : { hint }) };
}

export interface PreflightDeps {
  db: Db;
  now: () => number;
}

/**
 * 分项预检(01 §2):数据库/机器/采集/MCP/Agent/项目角色六项可校验,
 * 任一失败即不就绪;Bug Source 与 GitHub/CI 适配随业务闭环上线,先标未配置。
 */
export async function runPreflight(deps: PreflightDeps): Promise<PreflightResult> {
  const items: PreflightItem[] = [];

  const probe = await deps.db.get("SELECT 1 AS ok");
  items.push(
    probe === undefined
      ? item("database", "fail", "数据库探针无响应", "检查 compose PostgreSQL 与迁移状态")
      : item("database", "ok", "数据库连接与探针正常"),
  );

  const machines = (await listMachines(deps.db, { limit: 200 })).filter(
    (machine) => machine.status === "active",
  );
  const freshAt = deps.now() - HEARTBEAT_FRESH_MS;
  const heartbeatOk = machines.some(
    (machine) => machine.lastSeenAt !== null && machine.lastSeenAt >= freshAt,
  );
  if (machines.length === 0) {
    items.push(item("machine", "fail", "尚无执行机登记", "回到第 2 步:签发 enroll token 并在目标机安装 aw-node"));
  } else if (!heartbeatOk) {
    items.push(item("machine", "fail", `已登记 ${machines.length} 台,但 5 分钟内无心跳`, "在目标机检查 aw-node 服务状态(launchctl list 与 aw-node doctor)"));
  } else {
    items.push(item("machine", "ok", `执行机在线(${machines.length} 台,心跳正常)`));
  }

  const agents = (await listAgents(deps.db, { limit: 500 })).filter(
    (agent) => agent.status === "active",
  );
  const confirmed = agents.filter((agent) => agent.bootstrapStatus === "confirmed");
  const deliverableMachines = machines.filter((machine) =>
    confirmed.some((agent) => agent.machineId === machine.id),
  );
  const allEffective =
    deliverableMachines.length > 0 &&
    deliverableMachines.every((machine) => machine.configStatus === "effective");
  items.push(
    deliverableMachines.length === 0
      ? item("collection", "fail", "没有待生效的配置下发", "完成第 3 步项目确认,让 aw-node 拉取配置并回执")
      : allEffective
        ? item("collection", "ok", "运行时配置已下发并回执生效")
        : item("collection", "fail", "配置已确认但尚未回执生效", "等待目标机 aw-node 拉取配置(约 1 分钟)或查看 aw-node status 的 config_synced_at"),
  );

  const credentialsOk =
    confirmed.length > 0 &&
    confirmed.every((agent) => agent.secretHash !== null && agent.configAckAt !== null);
  items.push(
    confirmed.length === 0
      ? item("agent", "fail", "尚无确认的 Agent", "完成第 3 步:从发现结果确认项目与主责 Agent")
      : item("agent", "ok", `已确认 ${confirmed.length} 个 Agent`),
  );
  items.push(
    !credentialsOk
      ? item("mcp", "fail", "存在未签发或未回执的 Agent 密钥", "等待 aw-node 完成配置写入与 ACK;未回执前密钥仍在轮换")
      : item("mcp", "ok", "Agent Bearer 已签发并回执,远程 MCP 可用"),
  );

  const assembly = await findAssembly(deps.db);
  items.push(
    assembly === undefined
      ? item("roles", "fail", "默认 bug_fix 装配未完成,主责未绑定", "在第 4 步核对摘要后点击「确认并开始使用」")
      : item("roles", "ok", `主责 Agent 已绑定,work_kind=${assembly.workKind}`),
  );

  items.push(item("bug_source", "not_configured", "Bug 机器人接入未配置", NOT_CONFIGURED_HINT));
  items.push(item("github_ci", "not_configured", "GitHub/CI 接入未配置", NOT_CONFIGURED_HINT));

  const ready = items.every(
    (entry) => entry.status !== "fail" || entry.key === "bug_source" || entry.key === "github_ci",
  );
  return { items, ready };
}

export type CompleteDeps = PreflightDeps;

export interface CompleteResult {
  assembly: AssemblyRecord;
  definition: typeof DEFAULT_BUG_FIX;
  preflight: PreflightResult;
}

/**
 * /setup 第 4 步装配(01 §4):预检通过才落主责绑定;失败不写装配,
 * 也不创建任何派工副作用(WorkItem/Assignment 属业务闭环,不会在此出现)。
 * 重复调用幂等:已装配时返回既有结果。
 */
export async function completeBootstrap(
  deps: CompleteDeps,
  input: { primaryAgentId: string },
): Promise<CompleteResult> {
  const agent = await findAgentById(deps.db, input.primaryAgentId);
  if (agent === undefined) {
    throw new BootstrapError("NOT_FOUND", `Agent ${input.primaryAgentId} 不存在`);
  }
  if (agent.status !== "active") {
    throw new BootstrapError("VALIDATION_FAILED", `Agent ${input.primaryAgentId} 已停用`);
  }

  const existing = await findAssembly(deps.db);
  if (existing !== undefined) {
    return {
      assembly: existing,
      definition: DEFAULT_BUG_FIX,
      preflight: await runPreflight(deps),
    };
  }

  const { items } = await runPreflight(deps);
  // roles 项在装配前必然失败(先有绑定才可就绪),完成校验只看其余可校验项
  const failed = items.filter((entry) => entry.status === "fail" && entry.key !== "roles");
  if (failed.length > 0) {
    throw new BootstrapError("VALIDATION_FAILED", "预检未通过,未创建装配", {
      failed: failed.map((entry) => ({ key: entry.key, detail: entry.detail, hint: entry.hint })),
    });
  }

  const record: AssemblyRecord = {
    primaryAgentId: agent.id,
    workKind: DEFAULT_BUG_FIX.workKind,
    assembledAt: deps.now(),
  };
  await deps.db.transaction(async (tx) => {
    // 事务内复查:并发双确认只有一个赢家,输家按幂等语义返回既有装配
    if ((await findAssembly(tx)) === undefined) {
      await insertAssembly(tx, record);
    }
  });
  return {
    assembly: record,
    definition: DEFAULT_BUG_FIX,
    preflight: await runPreflight(deps),
  };
}
