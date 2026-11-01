import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { TaskDrawer } from "../components/task/TaskDrawer.js";

export function TaskDrawerRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const close = useCallback(() => {
    navigate(`/tasks${location.search}`);
  }, [navigate, location.search]);

  if (id === undefined) {
    return null;
  }
  return <TaskDrawer taskId={id} onClose={close} />;
}
