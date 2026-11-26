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
            className="block overflow-hidden whitespace-nowrap text-ellipsis text-foreground no-underline hover:text-accent hover:underline"
            to={workItemUrl(item.id, search)}
            state={{ from }}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="break-normal font-semibold text-foreground">{item.title}</span>
          </Link>
          <div className="mt-1 flex items-center gap-2 text-xs text-subtle">
            <span className="font-mono text-xs text-subtle">{item.id}</span>
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
      render: (item) => <span className="block overflow-hidden whitespace-nowrap text-ellipsis">{item.project}</span>,
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
          <span className="text-xs text-muted">尚未给出下一步</span>
        ) : (
          <span className="block overflow-hidden whitespace-nowrap text-ellipsis" title={item.nextAction}>
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
      <div className="block max-md:hidden">
        <Table
          columns={columns}
          rows={[...items]}
          rowKey={(item) => item.id}
          fixedLayout
          onRowClick={(item) => navigate(workItemUrl(item.id, search), { state: { from } })}
        />
      </div>

      {/* 窄屏转卡片:标题 + 注意力 + 项目 + 下一步(03 §8) */}
      <ul className="m-0 hidden list-none flex-col gap-3 p-0 max-md:flex" aria-label="工作事项卡片">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-border bg-surface">
            <Link
              className="flex min-h-touch flex-col gap-3 p-4 text-foreground no-underline active:bg-accent-soft"
              to={workItemUrl(item.id, search)}
              state={{ from }}
              aria-label={item.title}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="break-words text-md font-semibold">{item.title}</span>
                <Badge
                  tone={WORK_ITEM_ATTENTION_TONE[item.attention]}
                  text={WORK_ITEM_ATTENTION_LABEL[item.attention]}
                />
              </span>
              <span className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="text-xs text-muted">项目</span>
                <span>{item.project}</span>
                <span className="text-xs text-muted">阶段</span>
                <span>{WORK_ITEM_STAGE_LABEL[item.stage]}</span>
              </span>
              {item.nextAction === null ? null : (
                <span className="break-words text-sm text-text-secondary">{item.nextAction}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
