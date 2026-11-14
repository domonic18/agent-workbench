import type {
  DiscoveryProjectReport,
  DiscoveryReport,
} from "../../shared/aw-node-wire.js";
import type { Db } from "../../store/database.js";
import {
  listActiveAgentProjects,
  listMachines,
  saveMachineDiscovery,
  saveMachineSchedules,
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
  // 定时任务快照单独落 machine.schedules 列:发现快照只管项目元数据,两件事不混在一列
  const projects = input.report.projects ?? [];
  if (
    !(await saveMachineDiscovery(db, input.machineId, JSON.stringify({ projects }), receivedAt))
  ) {
    throw new BootstrapError("NOT_FOUND", `机器 ${input.machineId} 未注册`);
  }
  await saveMachineSchedules(db, input.machineId, input.report.schedules ?? []);
  // 发现上报顺带回写 bot 展示名:手动刷新与 7 天缓存到期都经此落地到 agent 表
  for (const project of projects) {
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
  /** 展示名:控制台可改;为空表示与 hostname 相同 */
  displayName: string | null;
  status: string;
  /** 心跳:aw-node 最近一次上报存活的时间 */
  lastSeenAt: number | null;
  /** 发现上报:最近一次上报 cc-connect 发现结果的时间,与心跳不同源 */
  receivedAt: number | null;
  /** 采集器版本:心跳活报,旧版采集器为 enroll 时落的值 */
  collectorVersion: string;
  /** 落后于控制台镜像的最新产物版本(版本号不可比或未发布产物时为 false) */
  upgradeAvailable: boolean;
  projects: DiscoveryProjectView[];
}

/** 点分数字版本比较;任一侧不是纯数字段视为不可比,返回 false(不误报升级) */
export function isVersionBehind(current: string, latest: string): boolean {
  const parse = (value: string): number[] | null => {
    if (!/^\d+(\.\d+)*$/.test(value)) {
      return null;
    }
    return value.split(".").map((part) => Number.parseInt(part, 10));
  };
  const a = parse(current);
  const b = parse(latest);
  if (a === null || b === null) {
    return false;
  }
  const width = Math.max(a.length, b.length);
  for (let i = 0; i < width; i += 1) {
    const l = a[i] ?? 0;
    const r = b[i] ?? 0;
    if (l !== r) {
      return l < r;
    }
  }
  return false;
}

/**
 * 控制台预填视图:发现项目合并已确认状态;控制台不读执行机文件系统,只见上报结果。
 * latestVersion 是控制台产物目录声明的最新采集器版本,用于逐机器标「可升级」。
 */
export async function listDiscoveryForConsole(
  db: Db,
  latestVersion: string | null = null,
): Promise<DiscoveryMachineView[]> {
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
      displayName: machine.displayName,
      status: machine.status,
      lastSeenAt: machine.lastSeenAt,
      receivedAt: machine.discoveryReceivedAt,
      collectorVersion: machine.collectorVersion,
      upgradeAvailable: latestVersion === null ? false : isVersionBehind(machine.collectorVersion, latestVersion),
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
