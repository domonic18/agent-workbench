import { Stepper } from "../ui/Stepper.js";

/** 首次使用四步：初始化 → 接入机器 → 确认项目 → 启用工作流 */
const SETUP_STEPS = [
  { key: "admin", label: "初始化" },
  { key: "machine", label: "接入机器" },
  { key: "projects", label: "确认项目" },
  { key: "bugfix", label: "启用工作流" },
];

export function SetupStepper({ step, completed = false }: { step?: number; completed?: boolean }) {
  // 全部完成时 current 越界，四步统一标记为已完成
  const current = completed
    ? SETUP_STEPS.length
    : Math.min(Math.max(step ?? 1, 1), SETUP_STEPS.length) - 1;
  return <Stepper steps={SETUP_STEPS} current={current} />;
}
