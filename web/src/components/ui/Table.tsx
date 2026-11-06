import type { ReactNode } from "react";
import styles from "./surfaces.module.css";

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
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
                className={ALIGN_CLASS[column.align ?? "left"]}
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
              {columns.map((column) => (
                <td key={column.key} className={ALIGN_CLASS[column.align ?? "left"]}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
