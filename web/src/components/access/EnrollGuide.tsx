import { AGENT_REST, MCP_ACCESS } from "@shared/constants.js";
import { formatDateTime } from "../../shared/format.js";
import { CopyBlock } from "../ui/CopyBlock.js";
import { Panel } from "../ui/Panel.js";
import type { AgentEnrollGrant } from "./types.js";
import { mcpServersSnippet } from "./snippets.js";
import styles from "./access.module.css";

export interface EnrollGuideProps {
  /** 已签发的接入令牌;null 表示还没签发 */
  grant: AgentEnrollGrant | null;
  /** 控制台对外地址(不含尾斜杠) */
  origin: string;
}

/** Agent 兑换密钥后的三步:换密钥、拉规范、查可委派目标 */
function enrollSteps(origin: string): string {
  return `BASE=${origin}
TOKEN=<上面那枚接入令牌>

# 1) 兑换密钥:令牌即凭据;兑换那一刻该 Agent 的旧密钥作废
curl -sS -X POST "$BASE${AGENT_REST.enroll}" \\
  -H 'content-type: application/json' \\
  -d "{\\"token\\":\\"$TOKEN\\"}"

# 2) 拉规范:照着规范做事,别凭印象猜协议
curl -sS "$BASE${AGENT_REST.guide}" \\
  -H "authorization: Bearer <agentId>.<secret>"

# 3) 查自己能发给谁:别猜 agent id
curl -sS "$BASE${AGENT_REST.peers}" \\
  -H "authorization: Bearer <agentId>.<secret>"`;
}

/**
 * 自助接入:人只交一枚一次性令牌,Agent 自己换密钥、拉规范、查可委派目标。
 * 不需要人替 Agent 改客户端配置文件。
 */
export function EnrollGuide({ grant, origin }: EnrollGuideProps) {
  return (
    <Panel
      title="自助接入"
      description="签一枚一次性令牌交给 Agent,它自己换密钥并按规范协作;人不用替它改配置。"
    >
      {grant === null ? (
        <p className={styles.hint}>
          在上面的名册里点某个 Agent 的「签发接入令牌」，这里会给出可以直接交给它的接入步骤。
        </p>
      ) : (
        <div className={styles.snippets}>
          <p className={styles.warning} role="alert">
            令牌只显示这一次，有效期到 {formatDateTime(grant.expiresAt)}、只能用一次。它等同密码，别发到公开频道；
            兑换时 {grant.displayName} 的旧密钥会立即作废。
          </p>
          <CopyBlock
            label="交给 Agent 的接入令牌"
            value={grant.token}
            note="把这枚令牌连同下面的步骤一起发给 Agent，它自己会填进去。"
          />
          <CopyBlock
            label="Agent 的接入步骤"
            value={enrollSteps(origin)}
            note="把令牌填进 $TOKEN 后执行；换到的密钥请存到本机文件或环境变量，不要写进仓库。"
          />
          <CopyBlock
            label="可选：MCP 通道配置"
            value={mcpServersSnippet(`${origin}${MCP_ACCESS.path}`, "Bearer <agentId>.<secret>")}
            note="想直接用 MCP 工具的客户端才需要；配置在客户端启动会话时读取，改完要新开一次会话。"
          />
        </div>
      )}
    </Panel>
  );
}
