import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { KnowledgeDetail } from "../components/knowledge/KnowledgeDetail.js";

export function KnowledgeDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const close = useCallback(() => {
    navigate(`/knowledge${location.search}`);
  }, [navigate, location.search]);

  if (id === undefined) {
    return null;
  }
  return <KnowledgeDetail entryId={id} onClose={close} />;
}
