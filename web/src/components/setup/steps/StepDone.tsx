import { useQuery } from "@tanstack/react-query";
import { runPreflight, type BootstrapStatus } from "../../../api/bootstrap.js";
import { Badge } from "../../ui/Badge.js";

export function StepDone({ status }: { status: BootstrapStatus }) {
  const preflight = useQuery({
    queryKey: ["bootstrap", "preflight"],
    queryFn: runPreflight,
    retry: false,
  });

  return (
    <div className="w-full bg-surface border border-border rounded-lg p-6 shadow-sm max-md:[&_input]:min-h-touch max-md:[&_select]:min-h-touch max-md:[&_button]:min-h-touch">
      <h1 className="m-0 mb-1 text-xl font-semibold">初始化完成</h1>
      <p className="text-muted m-0 mb-5 text-md">
        默认 bug_fix 已装配,主责 Agent 已绑定。现在可以去原 Bug 机器人反馈第一个问题,真实 Bug 闭环将在 M3.9 打通。
      </p>
      <ul className="list-none p-0 mt-3">
        {preflight.data?.items.map((item) => (
          <li key={item.key} className="flex items-baseline gap-2 py-1 text-md border-b border-border">
            <Badge
              tone={item.status === "ok" ? "positive" : item.status === "fail" ? "danger" : "muted"}
              text={item.status === "ok" ? "就绪" : item.status === "fail" ? "失败" : "未配置"}
            />
            <span>
              {item.detail}
              {item.hint === undefined ? null : <span className="text-muted text-xs mt-2"> — {item.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      {status.assembly === null ? null : (
        <p className="text-muted text-xs mt-2">主责 Agent:{status.assembly.primaryAgentId} · work_kind {status.assembly.workKind}</p>
      )}
    </div>
  );
}
