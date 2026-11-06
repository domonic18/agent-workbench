import { useCallback, useState } from "react";
import type { DiscoveryProjectView } from "../../api/bootstrap.js";

export interface ProjectGroup {
  machineId: string;
  /** 候选项目：该机本次要确认的项目 */
  projects: DiscoveryProjectView[];
}

/**
 * 项目勾选状态：按 (机器, 项目) 记「取消勾选」的项，默认全选。
 * 执行机接入页与首次使用引导共用同一套勾选语义——Agent 绑定的是机器，
 * 勾选状态因此必须按机器分开记。
 */
export function useProjectSelection(groups: ProjectGroup[]) {
  const [unchecked, setUnchecked] = useState<Record<string, Record<string, boolean>>>({});

  const toggle = useCallback((machineId: string, projectName: string, checked: boolean) => {
    setUnchecked((prev) => ({
      ...prev,
      [machineId]: { ...(prev[machineId] ?? {}), [projectName]: !checked },
    }));
  }, []);

  const isChecked = useCallback(
    (machineId: string, projectName: string) => unchecked[machineId]?.[projectName] !== true,
    [unchecked],
  );

  /** 各机已勾选的项目，按机器 id 索引 */
  const pickedByMachine: Record<string, DiscoveryProjectView[]> = {};
  for (const group of groups) {
    pickedByMachine[group.machineId] = group.projects.filter((project) =>
      isChecked(group.machineId, project.name),
    );
  }
  const pickedCount = Object.values(pickedByMachine).reduce((sum, list) => sum + list.length, 0);

  const pickedFor = (machineId: string): DiscoveryProjectView[] => pickedByMachine[machineId] ?? [];

  return { pickedFor, pickedCount, toggle, isChecked };
}
