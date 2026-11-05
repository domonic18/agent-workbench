import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { readTaskFilters, TASK_STATUSES } from "../../api/tasks.js";
import { TASK_STATUS_LABEL } from "../../shared/labels.js";
import styles from "./TaskFilters.module.css";

/** 筛选条件只存 URL query,刷新与回退后保持一致(03 §3) */
export function TaskFiltersForm({ statusSlot }: { statusSlot?: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readTaskFilters(searchParams);
  const [status, setStatus] = useState(filters.status ?? "");
  const [project, setProject] = useState(filters.project ?? "");
  const [assignee, setAssignee] = useState(filters.assignee ?? "");
  const [moreOpen, setMoreOpen] = useState(
    filters.project !== null || filters.assignee !== null,
  );

  useEffect(() => {
    setStatus(filters.status ?? "");
    setProject(filters.project ?? "");
    setAssignee(filters.assignee ?? "");
    if (filters.project !== null || filters.assignee !== null) {
      setMoreOpen(true);
    }
  }, [filters.status, filters.project, filters.assignee]);

  function applyStatus(nextStatus: string): void {
    const next = new URLSearchParams(searchParams);
    setOrDelete(next, "status", nextStatus);
    setSearchParams(next, { replace: true });
  }

  function apply(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    setOrDelete(next, "status", status);
    setOrDelete(next, "project", project);
    setOrDelete(next, "assignee", assignee);
    setSearchParams(next, { replace: true });
  }

  function reset(): void {
    const next = new URLSearchParams(searchParams);
    next.delete("status");
    next.delete("project");
    next.delete("assignee");
    setSearchParams(next, { replace: true });
  }

  return (
    <form className={styles.filters} onSubmit={apply} aria-label="任务筛选">
      <div className={styles.filterRow}>
        <div className={styles.chips} role="group" aria-label="状态筛选">
          <button
            type="button"
            className={`${styles.chip} ${status === "" ? styles.chipActive : ""}`}
            aria-pressed={status === ""}
            onClick={() => applyStatus("")}
          >
            全部
          </button>
          {TASK_STATUSES.map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.chip} ${status === value ? styles.chipActive : ""}`}
              aria-pressed={status === value}
              onClick={() => applyStatus(value)}
            >
              {TASK_STATUS_LABEL[value]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.moreToggle}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          更多筛选
        </button>
        <div className={styles.filterAside}>
          {statusSlot}
          <span className={styles.sortHint}>
            默认按最后事件倒序
            <span className={styles.help} title="任务按最后事件时间倒序排列，点任一行查看轮次链。">
              ?
            </span>
          </span>
        </div>
      </div>

      {moreOpen ? (
        <div className={styles.moreBody}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="task-filter-project">
              项目
            </label>
            <input
              id="task-filter-project"
              className={styles.control}
              value={project}
              onChange={(event) => setProject(event.target.value)}
              placeholder="全部项目"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="task-filter-assignee">
              承接方
            </label>
            <input
              id="task-filter-assignee"
              className={styles.control}
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              placeholder="Agent ID"
            />
          </div>
          <div className={styles.actions}>
            <button type="submit" className={styles.apply}>
              应用
            </button>
            <button type="button" className={styles.reset} onClick={reset}>
              重置
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function setOrDelete(params: URLSearchParams, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed === "") {
    params.delete(key);
  } else {
    params.set(key, trimmed);
  }
}
