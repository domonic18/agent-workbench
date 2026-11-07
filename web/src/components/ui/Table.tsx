import type { ReactNode } from "react";
import styles from "./surfaces.module.css";

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  /** 数字与短标签列不折行 */
  nowrap?: boolean;
  /** 实体名列（人名、Agent 名）：不用大写微标签样式 */
  plain?: boolean;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** 点击整行触发（编辑抽屉入口） */
  onRowClick?: (row: T) => void;
  /** 无数据时的占位 */
  empty?: ReactNode;
  /** 表格最小宽度，列多时靠横向滚动兜住 */
  minWidth?: string;
  /** 固定列宽：列宽严格按 columns.width 生效，长内容由单元格内元素自己截断 */
  fixedLayout?: boolean;
  /** 首列当行头渲染（scope="row"），用于「每行一个主体」的对照表 */
  rowHeader?: boolean;
}

const ALIGN_CLASS = {
  left: "",
  right: styles.right,
  center: styles.center,
} as const;

/** 粘性表头 + 行悬浮态的表格；窄屏由调用方转卡片 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  minWidth,
  fixedLayout = false,
  rowHeader = false,
}: TableProps<T>) {
  if (rows.length === 0 && empty !== undefined) {
    return <>{empty}</>;
  }
  return (
    <div className={styles.tableWrap}>
      <table
        className={`${styles.table}${fixedLayout ? ` ${styles.tableFixed}` : ""}`}
        style={minWidth === undefined ? undefined : { minWidth }}
      >
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width === undefined ? undefined : { width: column.width }}
                className={`${ALIGN_CLASS[column.align ?? "left"]} ${column.nowrap === true ? styles.nowrap : ""} ${column.plain === true ? styles.plainColumn : ""}`}
                data-align={column.align ?? "left"}
                data-nowrap={column.nowrap === true ? "true" : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick === undefined ? undefined : styles.clickable}
              onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
            >
              {columns.map((column, index) => {
                const isRowHeader = rowHeader && index === 0;
                const cellClass = `${ALIGN_CLASS[column.align ?? "left"]} ${column.nowrap === true ? styles.nowrap : ""} ${column.plain === true ? styles.plainColumn : ""}`;
                if (isRowHeader) {
                  return (
                    <th
                      key={column.key}
                      scope="row"
                      className={cellClass}
                      data-align={column.align ?? "left"}
                      data-nowrap={column.nowrap === true ? "true" : undefined}
                    >
                      {column.render(row)}
                    </th>
                  );
                }
                return (
                  <td
                    key={column.key}
                    className={cellClass}
                    data-align={column.align ?? "left"}
                    data-nowrap={column.nowrap === true ? "true" : undefined}
                  >
                    {column.render(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
