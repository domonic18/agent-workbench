import { lazy, Suspense } from "react";
import { Outlet } from "react-router";

/** 任务列表独立分包:抽屉打开时列表保持挂载,不闪一下空屏 */
const TasksPage = lazy(async () => {
  const module = await import("./TasksPage.js");
  return { default: module.TasksPage };
});

/**
 * 任务布局:/tasks、/tasks/:id 与 /work-items/:id 共用。
 * 工作事项抽屉是任务屏的下钻,叠在同一块列表之上(03 §3)。
 */
export function TasksLayout() {
  return (
    <>
      <Suspense fallback={null}>
        <TasksPage />
      </Suspense>
      {/* 详情抽屉独立分包,加载时保留列表视图不闪烁 */}
      <Suspense fallback={null}>
        <Outlet />
      </Suspense>
    </>
  );
}
