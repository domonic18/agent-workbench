import type { WorkItemDetail } from "../../api/work-items.js";
import { formatDateTime } from "../../shared/format.js";
import { JsonBlock, KeyValueList } from "./JsonBlock.js";
import styles from "./work-item-drawer.module.css";

export interface WorkItemOutcomeProps {
  item: WorkItemDetail;
}

/** 结果与验证:产出、验证依据与验收引用;发布仍是独立人工动作 */
export function WorkItemOutcome({ item }: WorkItemOutcomeProps) {
  return (
    <section className={styles.block} aria-label="结果与验证">
      <h3 className={styles.blockTitle}>结果与验证</h3>
      <KeyValueList
        items={[
          {
            key: "output",
            label: "产出",
            value: item.output ?? "尚无产出",
          },
          {
            key: "acceptance",
            label: "验收引用",
            value: item.acceptanceRef ?? "尚未验收",
          },
          {
            key: "ended",
            label: "结束时间",
            value: item.endedAt === null ? "未结束" : formatDateTime(item.endedAt),
          },
        ]}
      />
      <div className={styles.group}>
        <div className={styles.groupTitle}>验证依据</div>
        <JsonBlock value={item.validation} empty="尚无验证记录" />
      </div>
    </section>
  );
}
