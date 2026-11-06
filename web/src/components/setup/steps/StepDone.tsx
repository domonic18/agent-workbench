import { useQuery } from "@tanstack/react-query";
import { runPreflight, type BootstrapStatus } from "../../../api/bootstrap.js";
import { Badge } from "../../ui/Badge.js";
import styles from "../setup.module.css";

export function StepDone({ status }: { status: BootstrapStatus }) {
  const preflight = useQuery({
    queryKey: ["bootstrap", "preflight"],
    queryFn: runPreflight,
    retry: false,
  });

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>初始化完成</h1>
      <p className={styles.description}>
        默认 bug_fix 已装配,主责 Agent 已绑定。现在可以去原 Bug 机器人反馈第一个问题,真实 Bug 闭环将在 M3.9 打通。
      </p>
      <ul className={styles.checklist}>
        {preflight.data?.items.map((item) => (
          <li key={item.key} className={styles.checkItem}>
            <Badge
              tone={item.status === "ok" ? "positive" : item.status === "fail" ? "danger" : "muted"}
              text={item.status === "ok" ? "就绪" : item.status === "fail" ? "失败" : "未配置"}
            />
            <span>
              {item.detail}
              {item.hint === undefined ? null : <span className={styles.hint}> — {item.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      {status.assembly === null ? null : (
        <p className={styles.hint}>主责 Agent:{status.assembly.primaryAgentId} · work_kind {status.assembly.workKind}</p>
      )}
    </div>
  );
}
