import { Link, useNavigate } from "react-router";
import type { WorkItemListItem } from "../../api/work-items.js";
import { formatDateTime, formatRelativeTime } from "../../shared/format.js";
import {
  WORK_ITEM_ATTENTION_LABEL,
  WORK_ITEM_ATTENTION_TONE,
  WORK_ITEM_STAGE_LABEL,
} from "../../shared/labels.js";
import { Badge } from "../ui/Badge.js";
import { Table, type TableColumn } from "../ui/Table.js";
import styles from "./work-item-list.module.css";

export interface WorkItemTableProps {
  items: readonly WorkItemListItem[];
  /** 抽屉关闭后回到的路径 */
  from: string;
  /** 抽屉打开时带上的查询串,让背后的总览保持当前筛选 */
  search: string;
}

function workItemUrl(id: string, search: string): string {
  return `/work-items/${encodeURIComponent(id)}${search}`;
}

/** 工作事项表格：桌面表格 + 窄屏卡片 */
export function WorkItemTable({ items, from, search }: WorkItemTableProps) {
  const navigate = useNavigate();

  const columns: TableColumn<WorkItemListItem>[] = [
    {
      key: "item",
      header: "事项",
      width: "30%",
      render: (item) => (
        <>
          <Link
            className={styles.rowLink}
            to={workItemUrl(item.id, search)}
            state={{ from }}
            onClick={(event) => event.stopPropagation()}
          >
            <span className={styles.title}>{item.title}</span>
          </Link>
          <div className={styles.subline}>
            <span className={styles.mono}>{item.id}</span>
            <span>·</span>
            <span>{item.kind}</span>
          </div>
        </>
      ),
    },
    {
      key: "project",
      header: "项目",
      width: "12%",
      render: (item) => <span className={styles.clip}>{item.project}</span>,
    },
    {
      key: "stage",
      header: "阶段",
      width: "8%",
      nowrap: true,
      render: (item) => WORK_ITEM_STAGE_LABEL[item.stage],
    },
    {
      key: "attention",
      header: "注意力",
      width: "10%",
      nowrap: true,
      render: (item) => (
        <Badge
          tone={WORK_ITEM_ATTENTION_TONE[item.attention]}
          text={WORK_ITEM_ATTENTION_LABEL[item.attention]}
        />
      ),
    },
    {
      key: "next",
      header: "下一步",
      width: "25%",
      render: (item) =>
        item.nextAction === null ? (
          <span className={styles.muted}>尚未给出下一步</span>
        ) : (
          <span className={styles.clip} title={item.nextAction}>
            {item.nextAction}
          </span>
        ),
    },
    {
      key: "updated",
      header: "更新",
      width: "15%",
      nowrap: true,
      render: (item) => (
        <span title={formatDateTime(item.updatedAt)}>{formatRelativeTime(item.updatedAt)}</span>
      ),
    },
  ];

  return (
    <>
      <div className={styles.tableArea}>
        <Table
          columns={columns}
          rows={[...items]}
          rowKey={(item) => item.id}
          fixedLayout
          onRowClick={(item) => navigate(workItemUrl(item.id, search), { state: { from } })}
        />
      </div>

      {/* 窄屏转卡片:标题 + 注意力 + 项目 + 下一步(03 §8) */}
      <ul className={styles.cards} aria-label="工作事项卡片">
        {items.map((item) => (
          <li key={item.id} className={styles.card}>
            <Link
              className={styles.cardLink}
              to={workItemUrl(item.id, search)}
              state={{ from }}
              aria-label={item.title}
            >
              <span className={styles.cardTop}>
                <span className={styles.cardTitle}>{item.title}</span>
                <Badge
                  tone={WORK_ITEM_ATTENTION_TONE[item.attention]}
                  text={WORK_ITEM_ATTENTION_LABEL[item.attention]}
                />
              </span>
              <span className={styles.cardMeta}>
                <span className={styles.cardMetaLabel}>项目</span>
                <span>{item.project}</span>
                <span className={styles.cardMetaLabel}>阶段</span>
                <span>{WORK_ITEM_STAGE_LABEL[item.stage]}</span>
              </span>
              {item.nextAction === null ? null : (
                <span className={styles.cardNext}>{item.nextAction}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
