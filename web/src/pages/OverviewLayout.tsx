import { lazy, Suspense } from "react";
import { Outlet } from "react-router";

/** 与 App.tsx 同一份懒加载块,总览页在抽屉后面保持挂载 */
const OverviewPage = lazy(async () => {
  const module = await import("./OverviewPage.js");
  return { default: module.OverviewPage };
});

/** 总览布局:/overview 与 /work-items/:id 共用,后者是叠在总览之上的抽屉(03 §3) */
export function OverviewLayout() {
  return (
    <>
      <Suspense fallback={null}>
        <OverviewPage />
      </Suspense>
      <Outlet />
    </>
  );
}
