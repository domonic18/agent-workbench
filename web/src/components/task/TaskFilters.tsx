import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { readTaskFilters, TASK_STATUSES } from "../../api/tasks.js";
import { TASK_STATUS_LABEL } from "../../shared/labels.js";
import styles from "./task-list.module.css";

/** 筛选条件只存 URL query,刷新与回退后保持一致(03 §3) */
export function TaskFiltersForm() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readTaskFilters(searchParams);
  const [status, setStatus] = useState(filters.status ?? "");
  const [project, setProject] = useState(filters.project ?? "");
  const [assignee, setAssignee] = useState(filters.assignee ?? "");

  useEffect(() => {
    setStatus(filters.status ?? "");
    setProject(filters.project ?? "");
    setAssignee(filters.assignee ?? "");
  }, [filters.status, filters.project, filters.assignee]);

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
      <div className={styles.field}>
        <label className={styles.label} htmlFor="task-filter-status">
          状态
        </label>
        <select
          id="task-filter-status"
          className={styles.control}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">全部状态</option>
          {TASK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {TASK_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </div>
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
