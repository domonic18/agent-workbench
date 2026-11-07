import { MCP_ACCESS, formatBearer } from "@shared/constants.js";
import { CopyBlock } from "../ui/CopyBlock.js";
import { Panel } from "../ui/Panel.js";
import {
  AGENT_SECRET_ENV,
  exportSecretCommand,
  mcpServersSnippet,
  mcpServersSnippetWithEnv,
} from "./snippets.js";
import type { AgentCredentials } from "./types.js";
import styles from "./access.module.css";

/** 按协议常量拼出完整凭据头值,不在前端另写一份格式 */
export function bearerValue(credentials: AgentCredentials): string {
  return formatBearer(credentials.agentId, credentials.secret);
}

export interface AccessParametersProps {
  /** 客户端要连的端点(含路径) */
  endpoint: string;
  /** 对外地址未配置:片段按当前访问地址生成 */
  fallbackOrigin: boolean;
}

/** 接入参数卡:端点、传输方式、鉴权头与凭据格式——所有客户端共用一组 */
export function AccessParameters({ endpoint, fallbackOrigin }: AccessParametersProps) {
  return (
    <Panel
      title="接入参数"
      description="所有客户端连控制台 MCP 都用这一组参数；改地址只改控制台的对外配置。"
    >
      <dl className={styles.params}>
        <div className={styles.paramRow}>
          <dt className={styles.paramLabel}>端点</dt>
          <dd className={styles.paramValue}>{endpoint}</dd>
        </div>
        <div className={styles.paramRow}>
          <dt className={styles.paramLabel}>传输</dt>
          <dd className={styles.paramValue}>Streamable HTTP（仅 POST，GET / DELETE 返回 405）</dd>
        </div>
        <div className={styles.paramRow}>
          <dt className={styles.paramLabel}>鉴权头</dt>
          <dd className={styles.paramValue}>{MCP_ACCESS.authHeader}</dd>
        </div>
        <div className={styles.paramRow}>
          <dt className={styles.paramLabel}>凭据格式</dt>
          <dd className={styles.paramValue}>{MCP_ACCESS.bearerFormat}</dd>
        </div>
      </dl>
      {fallbackOrigin ? (
        <p className={styles.hint}>
          控制台未配置对外地址，上面的片段按你当前访问的地址生成；Agent 在别的机器上时，
          需先把控制台对外地址配好再复制。
        </p>
      ) : null}
    </Panel>
  );
}

export interface ConfigSnippetsProps {
  endpoint: string;
  /** 明文密钥:为 null 时只给接入参数,不出配置片段 */
  credentials: AgentCredentials | null;
}

/** 就绪配置片段:拿到明文密钥后按客户端给出可直接粘贴的配置 */
export function ConfigSnippets({ endpoint, credentials }: ConfigSnippetsProps) {
  return (
    <Panel
      title="就绪配置片段"
      description="按客户端给出可直接粘贴的配置；密钥明文只在拿到的那一瞬间存在页面里。"
    >
      {credentials === null ? (
        <p className={styles.hint}>
          还没有明文密钥。轮换或注册一个 Agent 后，这里会给出对应的配置片段。
        </p>
      ) : (
        <div className={styles.snippets}>
          <p className={styles.warning} role="alert">
            密钥只显示这一次，离开本页即不可再查看。已用旧密钥连着的 Agent 需要重新配置。
          </p>

          <p className={styles.groupLabel}>明文版：直接贴进客户端，密钥会明文留在配置文件里</p>
          <CopyBlock
            label="Claude Code"
            value={`claude mcp add --transport http aw-console ${endpoint} --header "${MCP_ACCESS.authHeader}: ${bearerValue(credentials)}"`}
            note="在装 Claude Code 的机器上执行；--header 可重复传多个头。这条命令含明文密钥、会进 shell history，介意就用下面的 env 版。"
          />
          <CopyBlock
            label="通用 MCP 客户端"
            value={mcpServersSnippet(endpoint, bearerValue(credentials))}
            note="支持 mcpServers 配置的客户端直接用这份 JSON。"
          />
          <CopyBlock
            label="WorkBuddy（Connector 表单三件套）"
            value={`URL: ${endpoint}\nHeader 名: ${MCP_ACCESS.authHeader}\nHeader 值: ${bearerValue(credentials)}`}
            note="WorkBuddy 用表单填这三项，不吃命令行；传输方式选 Streamable HTTP。"
          />

          <p className={styles.groupLabel}>env 版：密钥只留在本机环境变量里，配置文件可进仓库</p>
          <CopyBlock
            label="通用 MCP 客户端（env 版）"
            value={mcpServersSnippetWithEnv(endpoint, credentials.agentId)}
            note={`支持 \${VAR} 展开的客户端用这份（Claude Code 的 .mcp.json / ~/.claude.json 都行）：连接时从环境变量 ${AGENT_SECRET_ENV} 取密钥，文件里不留明文。`}
          />
          <CopyBlock
            label="设置环境变量"
            value={exportSecretCommand(credentials.secret)}
            note={`写进 shell profile（如 .zshrc），新开终端即生效。变量名固定为 ${AGENT_SECRET_ENV}，别把这一行提交进仓库。`}
          />
        </div>
      )}
    </Panel>
  );
}
