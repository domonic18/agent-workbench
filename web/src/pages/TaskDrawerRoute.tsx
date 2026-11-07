import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { TaskDrawer } from "../components/task/TaskDrawer.js";
import { navFrom } from "../shared/nav-state.js";

export function TaskDrawerRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const taskId = id ?? "";
  const from = navFrom(location.state);

  const close = useCallback(() => {
    navigate(from ?? `/tasks${location.search}`, { replace: true });
  }, [navigate, from, location.search]);

  const openWorkItem = useCallback(
    (workItemId: string) => {
      navigate(`/work-items/${encodeURIComponent(workItemId)}`, {
        state: { from: `/tasks/${encodeURIComponent(taskId)}${location.search}` },
      });
    },
    [navigate, taskId, location.search],
  );

  if (id === undefined) {
    return null;
  }
  return <TaskDrawer taskId={taskId} onClose={close} onOpenWorkItem={openWorkItem} />;
}
