import type {
  DiscoveryProjectReport,
  DiscoveryReport,
} from "../../shared/aw-node-wire.js";
import type { Db } from "../../store/database.js";
import {
  listActiveAgentProjects,
  listMachines,
  saveMachineDiscovery,
} from "../../store/repositories/identity.js";
import { BootstrapError } from "./errors.js";

export type { DiscoveryReport } from "../../shared/aw-node-wire.js";
export type DiscoveryProjectMeta = DiscoveryProjectReport;

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
}

export interface DiscoveryProjectView {
  name: string;
  cwd?: string | undefined;
  /** 该项目在本机是否已有登记 Agent,/setup 据此预勾选 */
  confirmed: boolean;
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
        confirmed: confirmed.has(project.name),
      })),
    });
  }
  return views;
}
