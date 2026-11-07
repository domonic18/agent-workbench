import type {
  DeliveredAgentConfig,
  PullConfigResponse,
} from "../../shared/aw-node-wire.js";
import { newPrefixedId } from "../../shared/ids.js";
import type { Db } from "../../store/database.js";
import {
  findMachineById,
  consumeMachineBotRefresh,
  requestMachineBotRefresh,
  updateMachineConfigStatus,
  type MachineConfigStatus,
} from "../../store/repositories/machine.js";
import {
  findAgentById,
  findAgentByKey,
  findAgentByMachineProject,
  insertAgent,
  listAgentsByMachine,
  markAgentConfigAck,
  rotateAgentDeliverySecret,
  type AgentRecord,
} from "../../store/repositories/agent.js";
import { hashSecret, newSecret } from "../security/secrets.js";
import { feishuBotsFromDiscovery } from "./discovery.js";
import { BootstrapError } from "./errors.js";

export type { DeliveredAgentConfig } from "../../shared/aw-node-wire.js";

/** key 是 Git 项目注册表引用的稳定键:小写字母数字与连字符,不以连字符开头/结尾 */
export const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function slugifyKey(project: string): string {
  const slug = project
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!KEY_PATTERN.test(slug)) {
    throw new BootstrapError(
      "VALIDATION_FAILED",
      `无法从项目名 ${project} 推导合法 key(需小写字母/数字/连字符),请显式指定 key`,
    );
  }
  return slug;
}

export interface ConfirmAgentEntry {
  project: string;
  displayName?: string | undefined;
  key?: string | undefined;
}

export interface ConfirmedAgent {
  id: string;
  key: string;
  project: string;
  displayName: string;
}

export interface ConfigDeliveryDeps {
  db: Db;
  now: () => number;
  newAgentId?: () => string;
  newSecret?: () => string;
}

function requireNonEmpty(value: string | undefined, field: string): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") {
    throw new BootstrapError("VALIDATION_FAILED", `${field} 不能为空`);
  }
  return trimmed;
}

/**
 * /setup 项目确认(01 §4):只创建身份与不含明文 Bearer 的待下发配置,
 * 不提前生成秘密——密钥改由 /api/aw-node/config 在 ACK 前轮换签发。
 * 校验与插入同事务:任一条目失败整体回滚,不留部分确认。
 */
export async function confirmAgents(
  deps: ConfigDeliveryDeps,
  input: { machineId: string; entries: ConfirmAgentEntry[] },
): Promise<ConfirmedAgent[]> {
  const machine = await findMachineById(deps.db, input.machineId);
  if (machine === undefined) {
    throw new BootstrapError("NOT_FOUND", `机器 ${input.machineId} 未注册`);
  }
  if (input.entries.length === 0) {
    throw new BootstrapError("VALIDATION_FAILED", "至少确认一个 Agent");
  }

  const newAgentId = deps.newAgentId ?? (() => newPrefixedId("agt"));
  const bots = feishuBotsFromDiscovery(machine.discoveryJson);
  return deps.db.transaction(async (tx) => {
    const seenProjects = new Set<string>();
    const seenKeys = new Set<string>();
    const confirmed: ConfirmedAgent[] = [];

    for (const entry of input.entries) {
      const project = requireNonEmpty(entry.project, "project");
      const displayName = requireNonEmpty(entry.displayName ?? project, "displayName");
      const key = entry.key === undefined ? slugifyKey(project) : entry.key;
      if (!KEY_PATTERN.test(key)) {
        throw new BootstrapError(
          "VALIDATION_FAILED",
          `key ${key} 不合法:小写字母/数字/连字符,2~63 位,不以连字符开头或结尾`,
        );
      }
      if (seenProjects.has(project) || seenKeys.has(key)) {
        throw new BootstrapError(
          "VALIDATION_FAILED",
          `请求内重复的 project 或 key: ${project}/${key}`,
        );
      }
      seenProjects.add(project);
      seenKeys.add(key);

      if ((await findAgentByMachineProject(tx, input.machineId, project)) !== undefined) {
        throw new BootstrapError(
          "CONFLICT",
          `机器 ${input.machineId} 下已存在项目 ${project} 的 Agent`,
        );
      }
      if ((await findAgentByKey(tx, key)) !== undefined) {
        throw new BootstrapError("CONFLICT", `key ${key} 已被其他 Agent 占用`);
      }

      const id = newAgentId();
      const bot = bots.get(project);
      await insertAgent(tx, {
        id,
        machineId: input.machineId,
        runtime: "claude_code",
        project,
        displayName,
        secretHash: null,
        key,
        mcpConfigJson: JSON.stringify({ endpoint: "/mcp", agent_id: id, key }),
        bootstrapStatus: "confirmed",
        feishuAppId: null,
        feishuBotName: bot?.name ?? null,
        feishuBotOpenId: bot !== undefined && bot.openId !== "" ? bot.openId : null,
        allowedTargetsJson: "[]",
        createdAt: deps.now(),
      });
      confirmed.push({ id, key, project, displayName });
    }

    // 已生效的机器新增 Agent 后回到待下发,等待下一次配置拉取
    if (!(await updateMachineConfigStatus(tx, input.machineId, "pending"))) {
      throw new BootstrapError("NOT_FOUND", `机器 ${input.machineId} 未注册`);
    }
    return confirmed;
  });
}

function mcpOf(agent: AgentRecord): { endpoint: string } {
  if (agent.mcpConfigJson === null) {
    return { endpoint: "/mcp" };
  }
  try {
    const parsed = JSON.parse(agent.mcpConfigJson) as { endpoint?: unknown };
    if (typeof parsed.endpoint === "string" && parsed.endpoint !== "") {
      return { endpoint: parsed.endpoint };
    }
  } catch {
    // 配置损坏时退回默认端点,不阻断下发
  }
  return { endpoint: "/mcp" };
}

/**
 * 下发名单:只有本机 aw-node 接管的 Agent 才由控制台写进 claude.json。
 * 外部运行时(WorkBuddy 等)即便登记了宿主机器,其配置由自己的客户端持有。
 */
function isDeliverable(agent: AgentRecord): boolean {
  return (
    agent.status === "active" &&
    agent.bootstrapStatus === "confirmed" &&
    agent.runtime === "claude_code"
  );
}

/**
 * 控制台发起「刷新 bot 名」:记录请求时刻,aw-node 下次拉配置时下发 refresh_bot_names
 * 并清空标记。幂等——重复点击只是重置时刻,不累积。
 */
export async function requestBotNameRefresh(
  deps: ConfigDeliveryDeps,
  machineId: string,
): Promise<void> {
  if (!(await requestMachineBotRefresh(deps.db, machineId, deps.now()))) {
    throw new BootstrapError("NOT_FOUND", `机器 ${machineId} 未注册`);
  }
}

/**
 * ACK 前的配置拉取:未回执的 confirmed Agent 每次都轮换密钥并推进版本,
 * 旧明文立即失效——响应丢失后重试安全,拿到的永远是最新有效密钥。
 * 已回执的 Agent 不再轮换、不再返回明文。
 */
export async function pullMachineConfig(
  deps: ConfigDeliveryDeps,
  input: { machineId: string },
): Promise<PullConfigResponse> {
  const machine = await findMachineById(deps.db, input.machineId);
  if (machine === undefined) {
    throw new BootstrapError("NOT_FOUND", `机器 ${input.machineId} 未注册`);
  }
  const generateSecret = deps.newSecret ?? newSecret;

  // 密钥哈希在事务外算:scrypt 是百毫秒级 CPU 计算,放进事务会把连接与事务一起按住,
  // Agent 一多就把事务拖成长事务。事务内仍按权威名单复核,预读之后新出现的补算。
  const prepared = new Map<string, { secret: string; hash: string }>();
  for (const agent of await listAgentsByMachine(deps.db, input.machineId)) {
    if (!isDeliverable(agent) || agent.configAckAt !== null) {
      continue;
    }
    const secret = generateSecret();
    prepared.set(agent.id, { secret, hash: await hashSecret(secret) });
  }

  return deps.db.transaction(async (tx) => {
    const refreshBotNames = await consumeMachineBotRefresh(tx, input.machineId);
    const agents = (await listAgentsByMachine(tx, input.machineId)).filter(isDeliverable);
    const delivered: DeliveredAgentConfig[] = [];
    let rotatedAny = false;

    for (const agent of agents) {
      if (agent.configAckAt === null) {
        const plan = prepared.get(agent.id);
        const secret = plan?.secret ?? generateSecret();
        const hash = plan?.hash ?? (await hashSecret(secret));
        const version = agent.configVersion + 1;
        if (!(await rotateAgentDeliverySecret(tx, agent.id, hash, version, deps.now()))) {
          throw new BootstrapError("NOT_FOUND", `Agent ${agent.id} 不存在`);
        }
        rotatedAny = true;
        delivered.push({
          agent_id: agent.id,
          key: agent.key ?? agent.id,
          project: agent.project,
          config_version: version,
          rotated: true,
          secret,
          mcp: mcpOf(agent),
        });
      } else {
        delivered.push({
          agent_id: agent.id,
          key: agent.key ?? agent.id,
          project: agent.project,
          config_version: agent.configVersion,
          rotated: false,
          mcp: mcpOf(agent),
        });
      }
    }

    const status: MachineConfigStatus = rotatedAny ? "delivered" : machine.configStatus;
    if (rotatedAny) {
      await updateMachineConfigStatus(tx, input.machineId, status);
    }
    return { config_status: status, agents: delivered, refresh_bot_names: refreshBotNames };
  });
}

export interface ConfigAckEntry {
  agentId: string;
  configVersion: number;
}

/**
 * 配置回执:aw-node 确认各 Agent 配置已写入生效。归属不匹配 403、版本过期 409;
 * 全部 confirmed Agent 回执后机器转 effective。回执与状态推进同事务。
 */
export async function ackMachineConfig(
  deps: ConfigDeliveryDeps,
  input: { machineId: string; acks: ConfigAckEntry[] },
): Promise<{ config_status: MachineConfigStatus; acked: string[] }> {
  const machine = await findMachineById(deps.db, input.machineId);
  if (machine === undefined) {
    throw new BootstrapError("NOT_FOUND", `机器 ${input.machineId} 未注册`);
  }
  if (input.acks.length === 0) {
    throw new BootstrapError("VALIDATION_FAILED", "至少回执一个 Agent");
  }

  return deps.db.transaction(async (tx) => {
    const acked: string[] = [];
    for (const entry of input.acks) {
      const agent = await findAgentById(tx, entry.agentId);
      if (agent === undefined) {
        throw new BootstrapError("NOT_FOUND", `Agent ${entry.agentId} 不存在`);
      }
      if (agent.machineId !== input.machineId) {
        throw new BootstrapError("FORBIDDEN", `Agent ${entry.agentId} 不属于机器 ${input.machineId}`);
      }
      if (!(await markAgentConfigAck(tx, entry.agentId, entry.configVersion, deps.now()))) {
        throw new BootstrapError("CONFLICT", `Agent ${entry.agentId} 配置版本不符或尚未下发`, {
          agent_id: entry.agentId,
          current_version: agent.configVersion,
          acked_version: entry.configVersion,
        });
      }
      acked.push(entry.agentId);
    }

    const pending = (await listAgentsByMachine(tx, input.machineId)).filter(
      (agent) =>
        agent.status === "active" &&
        agent.bootstrapStatus === "confirmed" &&
        agent.configAckAt === null &&
        agent.runtime === "claude_code",
    );
    const status: MachineConfigStatus = pending.length === 0 ? "effective" : "delivered";
    await updateMachineConfigStatus(tx, input.machineId, status);
    return { config_status: status, acked };
  });
}
