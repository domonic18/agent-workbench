import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MCP_ACCESS } from "@shared/constants.js";
import { fetchAgentKit } from "../api/agent-kit.js";
import { ApiError } from "../api/client.js";
import { fetchAgents } from "../api/identity.js";
import { AccessPaths } from "../components/access/AccessPaths.js";
import { AgentRoster } from "../components/access/AgentRoster.js";
import { EnrollDialog } from "../components/access/EnrollDialog.js";
import { AccessParameters, ConfigSnippets } from "../components/access/McpConfig.js";
import type { AgentCredentials, AgentEnrollGrant } from "../components/access/types.js";
import { AsyncSection } from "../components/ui/AsyncSection.js";
import { Button } from "../components/ui/Button.js";
import { Panel } from "../components/ui/Panel.js";
import { formatDateTime } from "../shared/format.js";
import styles from "./AgentAccessPage.module.css";

/**
 * 协作接入：把「接入参数 + 凭据」一次性交给人。
 * 两条路径并存——手工路径贴配置到客户端；自助路径只交一段接入包，Agent 自己换密钥并按规范协作。
 */
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
    <div className={styles.page}>
      <AccessPaths />

      <AccessParameters endpoint={endpoint} fallbackOrigin={publicUrl === null} />

      <Panel
        title="Agent 名册"
        description="每个 Agent 一把密钥。「签发接入令牌」走自助路径，「轮换密钥」走手工路径。"
      >
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
        <div className={styles.recentEnroll}>
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
