import { MCP_ACCESS, formatBearer } from "@shared/constants.js";
import { CopyBlock } from "../ui/CopyBlock.js";
import { Panel } from "../ui/Panel.js";
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
  return (
    <Panel title="就绪配置片段">
      {credentials === null ? null : (
        <div className={snippets}>
          <p className={warning} role="alert">
            密钥只显示这一次，离开本页即不可再查看。已用旧密钥连着的 Agent 需要重新配置。
          </p>

          <CopyBlock
            label="Claude Code"
            value={`claude mcp add --transport http aw-console ${endpoint} --header "${MCP_ACCESS.authHeader}: ${bearerValue(credentials)}"`}
          />
          <CopyBlock
            label="通用 MCP 客户端"
            value={mcpServersSnippet(endpoint, bearerValue(credentials))}
          />
          <CopyBlock
            label="WorkBuddy"
            value={`URL: ${endpoint}\nHeader 名: ${MCP_ACCESS.authHeader}\nHeader 值: ${bearerValue(credentials)}`}
          />

          <CopyBlock
            label="通用 MCP 客户端（env 版）"
            value={mcpServersSnippetWithEnv(endpoint, credentials.agentId)}
          />
          <CopyBlock
            label="设置环境变量"
            value={exportSecretCommand(credentials.secret)}
          />
        </div>
      )}
    </Panel>
  );
}
