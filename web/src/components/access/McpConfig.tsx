import { useState } from "react";
import { MCP_ACCESS, formatBearer } from "@shared/constants.js";
import { CopyBlock } from "../ui/CopyBlock.js";
import { Panel } from "../ui/Panel.js";
import { Tabs } from "../ui/Tabs.js";
import {
  exportSecretCommand,
  mcpServersSnippet,
  mcpServersSnippetWithEnv,
} from "./snippets.js";
import type { AgentCredentials } from "./types.js";

const params = "m-0 flex flex-col gap-2";
const paramRow = "flex flex-wrap gap-x-4 gap-y-2 max-md:flex-col";
const paramLabel = "shrink-0 min-w-[88px] text-sm font-semibold text-text-secondary";
const paramValue = "m-0 min-w-0 flex-1 font-mono text-sm text-foreground [overflow-wrap:anywhere]";
const warning =
  "m-0 rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-foreground";
const snippets = "flex flex-col gap-4";

export function bearerValue(credentials: AgentCredentials): string {
  return formatBearer(credentials.agentId, credentials.secret);
}

export interface AccessParametersProps {
  endpoint: string;
  fallbackOrigin: boolean;
}

export function AccessParameters({ endpoint, fallbackOrigin: _fallbackOrigin }: AccessParametersProps) {
  return (
    <Panel title="接入参数">
      <dl className={params}>
        <div className={paramRow}>
          <dt className={paramLabel}>端点</dt>
          <dd className={paramValue}>{endpoint}</dd>
        </div>
        <div className={paramRow}>
          <dt className={paramLabel}>鉴权头</dt>
          <dd className={paramValue}>{MCP_ACCESS.authHeader}</dd>
        </div>
        <div className={paramRow}>
          <dt className={paramLabel}>凭据格式</dt>
          <dd className={paramValue}>{MCP_ACCESS.bearerFormat}</dd>
        </div>
      </dl>
    </Panel>
  );
}

export interface ConfigSnippetsProps {
  endpoint: string;
  credentials: AgentCredentials | null;
}

export function ConfigSnippets({ endpoint, credentials }: ConfigSnippetsProps) {
  const [activeClient, setActiveClient] = useState("claude-code");
  if (credentials === null) {
    return (
      <Panel title="就绪配置片段">
        <p className="text-sm text-muted">从 Agent 名册选择一名 Agent 并轮换/查看密钥后，方可生成配置片段。</p>
      </Panel>
    );
  }

  const bearer = bearerValue(credentials);
  const commonWarning = (
    <p className={warning} role="alert">
      密钥只显示这一次，离开本页即不可再查看。已用旧密钥连着的 Agent 需要重新配置。
    </p>
  );

  return (
    <Panel title="就绪配置片段">
      <div className={snippets}>
        {commonWarning}
        <Tabs
          value={activeClient}
          onValueChange={setActiveClient}
          items={[
            {
              key: "claude-code",
              label: "Claude Code",
              content: (
                <CopyBlock
                  label="添加 aw-console MCP"
                  value={`claude mcp add --transport http aw-console ${endpoint} --header "${MCP_ACCESS.authHeader}: ${bearer}"`}
                />
              ),
            },
            {
              key: "generic",
              label: "通用 MCP",
              content: (
                <div className={snippets}>
                  <CopyBlock label="mcpServers 配置（env 版，推荐进仓库）" value={mcpServersSnippetWithEnv(endpoint, credentials.agentId)} />
                  <CopyBlock label="设置环境变量" value={exportSecretCommand(credentials.secret)} />
                  <CopyBlock label="mcpServers 配置（明文版）" value={mcpServersSnippet(endpoint, bearer)} />
                </div>
              ),
            },
            {
              key: "workbuddy",
              label: "WorkBuddy",
              content: (
                <CopyBlock
                  label="WorkBuddy 连接参数"
                  value={`URL: ${endpoint}\nHeader 名: ${MCP_ACCESS.authHeader}\nHeader 值: ${bearer}`}
                />
              ),
            },
          ]}
        />
      </div>
    </Panel>
  );
}
