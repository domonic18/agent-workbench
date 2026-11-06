import type {
  DiscoveryProjectReport,
  DiscoveryReport,
} from "../../shared/aw-node-wire.js";
import type { Db } from "../../store/database.js";
import {
  listActiveAgentProjects,
  listMachines,
  saveMachineDiscovery,
} from "../../store/repositories/machine.js";
import { updateAgentFeishuBotByProject } from "../../store/repositories/agent.js";
import { BootstrapError } from "./errors.js";

export type { DiscoveryReport } from "../../shared/aw-node-wire.js";
export type DiscoveryProjectMeta = DiscoveryProjectReport;

export interface FeishuBotMeta {
  name: string;
  openId: string;
}

/** 从机器发现 JSON 解析 项目名 → 飞书 bot 元数据;确认 Agent 时落库,损坏数据不阻断 */
export function feishuBotsFromDiscovery(
  discoveryJson: string | null,
): Map<string, FeishuBotMeta> {
  const result = new Map<string, FeishuBotMeta>();
  if (discoveryJson === null) {
    return result;
  }
  try {
    const parsed = JSON.parse(discoveryJson) as DiscoveryReport;
    for (const project of parsed.projects ?? []) {
      if (typeof project.feishu_bot_name !== "string" || project.feishu_bot_name === "") {
        continue;
      }
      result.set(project.name, {
        name: project.feishu_bot_name,
        openId: typeof project.feishu_bot_open_id === "string" ? project.feishu_bot_open_id : "",
      });
    }
  } catch {
    // 发现数据损坏时不阻断确认,Agent 仍以项目名落库
  }
  return result;
}

/** 上报整包覆盖:发现结果反映 aw-node 最新一次扫描,不做增量合并 */
export async function saveDiscoveryReport(
  db: Db,
  input: { machineId: string; report: DiscoveryReport; now: () => number },
): Promise<void> {
  const receivedAt = input.now();
  if (
    !(await saveMachineDiscovery(db, input.machineId, JSON.stringify(input.report), receivedAt))
  ) {
    throw new BootstrapError("NOT_FOUND", `机器 ${input.machineId} 未注册`);
  }
  // 发现上报顺带回写 bot 展示名:手动刷新与 7 天缓存到期都经此落地到 agent 表
  for (const project of input.report.projects ?? []) {
    if (typeof project.feishu_bot_name !== "string" || project.feishu_bot_name === "") {
      continue;
    }
    if (typeof project.feishu_bot_open_id !== "string" || project.feishu_bot_open_id === "") {
      continue;
    }
    await updateAgentFeishuBotByProject(
      db,
      input.machineId,
      project.name,
      project.feishu_bot_open_id,
      project.feishu_bot_name,
      receivedAt,
    );
  }
}

export interface DiscoveryProjectView {
  name: string;
  cwd?: string | undefined;
  /** 该项目在本机是否已有登记 Agent,/setup 据此预勾选 */
  confirmed: boolean;
  feishuBotName?: string | undefined;
}

export interface DiscoveryMachineView {
  machineId: string;
  hostname: string;
  status: string;
  receivedAt: number | null;
  projects: DiscoveryProjectView[];
}

/** 控制台预填视图:发现项目合并已确认状态;控制台不读执行机文件系统,只见上报结果 */
export async function listDiscoveryForConsole(db: Db): Promise<DiscoveryMachineView[]> {
  const machines = await listMachines(db, { limit: 200 });
  const views: DiscoveryMachineView[] = [];
  for (const machine of machines) {
    const confirmed = new Set(await listActiveAgentProjects(db, machine.id));
    let projects: DiscoveryProjectMeta[] = [];
    if (machine.discoveryJson !== null) {
      try {
        projects = (JSON.parse(machine.discoveryJson) as DiscoveryReport).projects ?? [];
      } catch {
        projects = [];
      }
    }
    views.push({
      machineId: machine.id,
      hostname: machine.hostname,
      status: machine.status,
      receivedAt: machine.discoveryReceivedAt,
      projects: projects.map((project) => ({
        name: project.name,
        ...(project.cwd === undefined ? {} : { cwd: project.cwd }),
        ...(project.feishu_bot_name === undefined || project.feishu_bot_name === ""
          ? {}
          : { feishuBotName: project.feishu_bot_name }),
        confirmed: confirmed.has(project.name),
      })),
    });
  }
  return views;
}
