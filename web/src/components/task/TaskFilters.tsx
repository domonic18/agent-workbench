import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { readTaskFilters, TASK_STATUSES } from "../../api/tasks.js";
import { TASK_STATUS_LABEL } from "../../shared/labels.js";
import { Button } from "../ui/Button.js";
import { ChipGroup } from "../ui/Chip.js";
import { Input } from "../ui/Field.js";

/** 筛选条件只存 URL query,刷新与回退后保持一致(03 §3) */
export function TaskFiltersForm() {
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
    <form className="mb-4 flex flex-col gap-3" onSubmit={apply} aria-label="任务筛选">
      <div className="flex flex-wrap items-center gap-3 max-md:items-start">
        <ChipGroup
          label="状态筛选"
          value={status}
          onValueChange={applyStatus}
          options={[
            { key: "", label: "全部" },
            ...TASK_STATUSES.map((value) => ({
              key: value,
              label: TASK_STATUS_LABEL[value],
            })),
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
        >
          更多筛选
        </Button>
        <div className="ml-auto flex items-center gap-3 max-md:hidden">
          <span
            className="text-xs text-subtle max-[900px]:ml-0"
            title="任务按最后事件时间倒序排列，点任一行查看轮次链。"
          >
            默认按最后事件倒序
          </span>
        </div>
      </div>

      {moreOpen ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4 max-md:flex-col max-md:items-stretch">
          <div className="flex min-w-[160px] flex-col gap-2 max-md:w-full">
            <label
              className="text-sm font-semibold text-text-secondary"
              htmlFor="task-filter-project"
            >
              项目
            </label>
            <Input
              id="task-filter-project"
              value={project}
              onChange={(event) => setProject(event.target.value)}
              placeholder="全部项目"
            />
          </div>
          <div className="flex min-w-[160px] flex-col gap-2 max-md:w-full">
            <label
              className="text-sm font-semibold text-text-secondary"
              htmlFor="task-filter-assignee"
            >
              承接方
            </label>
            <Input
              id="task-filter-assignee"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              placeholder="Agent ID"
            />
          </div>
          <div className="flex gap-2 max-md:w-full max-md:[&>button]:flex-1">
            <Button type="submit" variant="primary">
              应用
            </Button>
            <Button variant="secondary" onClick={reset}>
              重置
            </Button>
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
