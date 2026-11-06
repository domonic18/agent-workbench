import { useQuery } from "@tanstack/react-query";
import { fetchDiscovery, type DiscoveryMachineView } from "../../api/bootstrap.js";
import { formatRelativeTime } from "../../shared/format.js";
import { Badge } from "../ui/Badge.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Panel } from "../ui/Panel.js";
import type { Tone } from "../../shared/labels.js";
import styles from "./onboarding.module.css";

const STATUS_TONE: Record<string, Tone> = {
  active: "positive",
  pending: "warning",
  revoked: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  active: "已激活",
  pending: "待激活",
  revoked: "已吊销",
};

function MachineRow({ machine }: { machine: DiscoveryMachineView }) {
  const tone = STATUS_TONE[machine.status] ?? "muted";
  const label = STATUS_LABEL[machine.status] ?? machine.status;
  const confirmed = machine.projects.filter((project) => project.confirmed).length;
  return (
    <li className={styles.machineRow}>
      <div className={styles.machineIdentity}>
        <span className={styles.machineName}>{machine.hostname}</span>
        <span className={styles.machineSub}>
          {machine.machineId} ·{" "}
          {machine.receivedAt === null
            ? "尚未上报心跳"
            : `${formatRelativeTime(machine.receivedAt)}上报心跳`}
        </span>
      </div>
      <div className={styles.machineTags}>
        <span className={styles.machineSub}>
          项目 {machine.projects.length} 个（已登记 {confirmed}）
        </span>
        <Badge tone={tone} text={label} />
      </div>
    </li>
  );
}

/** 第 3 步下半：已上线机器清单。执行机每轮心跳都会回报，控制台按轮询刷新。 */
export function OnlineMachines() {
  const machines = useQuery({
    queryKey: ["discovery"],
    queryFn: fetchDiscovery,
    refetchInterval: 10_000,
  });

  const list = machines.data?.machines ?? [];

  return (
    <Panel
      title="已上线执行机"
      description="执行机 enroll 成功后开始上报心跳，这里按机器维度列出状态与发现到的项目。"
    >
      {machines.isPending ? <p className={styles.hint}>读取执行机列表…</p> : null}
      {machines.isError ? (
        <p className={styles.hint} role="alert">
          读取执行机列表失败，稍后自动重试。
        </p>
      ) : null}
      {!machines.isPending && list.length === 0 ? (
        <EmptyState
          title="还没有执行机上线"
          description="在目标机跑完安装命令并完成 enroll 后，这里会立刻出现该机器。"
        />
      ) : (
        <ul className={styles.machineList}>
          {list.map((machine) => (
            <MachineRow key={machine.machineId} machine={machine} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
