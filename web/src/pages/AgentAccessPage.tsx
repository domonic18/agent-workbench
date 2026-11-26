import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MCP_ACCESS } from "@shared/constants.js";
import { fetchAgentKit } from "../api/agent-kit.js";
import { ApiError } from "../api/client.js";
import { fetchAgents } from "../api/identity.js";
import { AgentRoster } from "../components/access/AgentRoster.js";
import { EnrollDialog } from "../components/access/EnrollDialog.js";
import { AccessParameters, ConfigSnippets } from "../components/access/McpConfig.js";
import type { AgentCredentials, AgentEnrollGrant } from "../components/access/types.js";
import { OnlineMachines } from "../components/onboarding/OnlineMachines.js";
import { AsyncSection } from "../components/ui/AsyncSection.js";
import { Button } from "../components/ui/Button.js";
import { Panel } from "../components/ui/Panel.js";
import { formatDateTime } from "../shared/format.js";

export function AgentAccessPage() {
  const [credentials, setCredentials] = useState<AgentCredentials | null>(null);
  const [grant, setGrant] = useState<AgentEnrollGrant | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);

  const kit = useQuery({
    queryKey: ["agent-kit"],
    queryFn: fetchAgentKit,
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });

  // 未配置对外地址时按当前访问地址生成,保证片段至少在本机可用
  const publicUrl = kit.data?.publicUrl ?? null;
  const origin = publicUrl ?? window.location.origin;
  const endpoint = `${origin}${MCP_ACCESS.path}`;

  return (
    <div className="flex flex-col gap-5">
      <AccessParameters endpoint={endpoint} fallbackOrigin={publicUrl === null} />

      <OnlineMachines />

      <Panel title="Agent 名册">
        <AsyncSection
          pending={agents.isPending}
          error={
            agents.isError
              ? agents.error instanceof ApiError
                ? agents.error.message
                : "Agent 名册加载失败"
              : null
          }
          onRetry={() => void agents.refetch()}
          hasMore={false}
          fetchingMore={false}
          onLoadMore={() => undefined}
        >
          <AgentRoster
            agents={agents.data ?? []}
            onCredentials={setCredentials}
            onEnroll={(issued) => {
              setGrant(issued);
              setEnrollOpen(true);
            }}
          />
        </AsyncSection>
      </Panel>

      {grant === null || enrollOpen ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border border-border rounded-md bg-surface-2 text-sm text-text-secondary">
          <span>
            已为 {grant.displayName} 签发接入令牌，有效期到 {formatDateTime(grant.expiresAt)}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setEnrollOpen(true)}>
            查看接入包
          </Button>
        </div>
      )}

      <ConfigSnippets endpoint={endpoint} credentials={credentials} />

      {grant !== null && enrollOpen ? (
        <EnrollDialog grant={grant} origin={origin} onClose={() => setEnrollOpen(false)} />
      ) : null}
    </div>
  );
}
