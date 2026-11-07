import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { WorkItemDrawer } from "../components/work-item/WorkItemDrawer.js";
import { navFrom } from "../shared/nav-state.js";

export function WorkItemDrawerRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const workItemId = id ?? "";
  const from = navFrom(location.state) ?? "/overview";

  const close = useCallback(() => {
    navigate(from, { replace: true });
  }, [navigate, from]);

  const openTask = useCallback(
    (taskId: string) => {
      navigate(`/tasks/${encodeURIComponent(taskId)}`, {
        state: { from: `/work-items/${encodeURIComponent(workItemId)}${location.search}` },
      });
    },
    [navigate, workItemId, location.search],
  );

  if (id === undefined) {
    return null;
  }
  return <WorkItemDrawer workItemId={workItemId} onClose={close} onOpenTask={openTask} />;
}
