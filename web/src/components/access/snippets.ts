import { AGENT_REST, MCP_ACCESS } from "@shared/constants.js";

/** 放密钥的环境变量名;env 版配置靠它从本机环境取明文 */
export const AGENT_SECRET_ENV = "AW_AGENT_SECRET";

/** 文案里引用的字面量 `${AW_AGENT_SECRET}`;变量名固定,故写死不从模板插值 */
const ENV_REF = "${" + AGENT_SECRET_ENV + "}";

/**
 * 通用 MCP 客户端配置:手工接入与自助接入两处共用一份,
 * 免得客户端配置形状只改一处。
 */
export function mcpServersSnippet(endpoint: string, authorization: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "aw-console": {
          type: "http",
          url: endpoint,
          headers: { [MCP_ACCESS.authHeader]: authorization },
        },
      },
    },
    null,
    2,
  );
}

/**
 * env 版 MCP 客户端配置:凭据写成 ${AW_AGENT_SECRET},由客户端在连接时从本机环境变量取。
 * 支持变量展开的客户端(如 Claude Code)可以直接把这份文件放进仓库,不落明文密钥。
 */
export function mcpServersSnippetWithEnv(endpoint: string, agentId: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "aw-console": {
          type: "http",
          url: endpoint,
          headers: {
            [MCP_ACCESS.authHeader]: `Bearer ${agentId}.${ENV_REF}`,
          },
        },
      },
    },
    null,
    2,
  );
}

/** 把密钥放进环境变量的一行;写进 shell profile 即可长期生效 */
export function exportSecretCommand(secret: string): string {
  return `export ${AGENT_SECRET_ENV}=${secret}`;
}

/**
 * 交给 Agent 的接入包:一段自带地址、令牌与三步命令的文本。
 * 人只需整段复制粘贴,不必自己把令牌和命令拼在一起。
 */
export function enrollPackage(origin: string, agentName: string, token: string): string {
  return `你现在接入 agent-workbench 控制台（${agentName}）。下面这段是接入凭据与步骤，照做即可。

控制台地址：${origin}
接入令牌：${token}
（令牌只能用一次；兑换成功那一刻，该 Agent 的旧密钥立即失效。）

第 1 步 兑换密钥
curl -sS -X POST "${origin}${AGENT_REST.enroll}" \\
  -H 'content-type: application/json' \\
  -d '{"token":"${token}"}'
返回形如 {"agent_id":"agt_xxx","secret":"...","authorization":"Bearer agt_xxx.xxx"}。
把 secret 存进本机环境变量或本机文件，不要写进仓库、也不要贴在聊天记录里。

第 2 步 拉协作规范
curl -sS "${origin}${AGENT_REST.guide}" \\
  -H "authorization: Bearer <agentId>.<secret>"
返回 JSON，guide 字段是规范正文；照它做事。

第 3 步 查你能发给谁
curl -sS "${origin}${AGENT_REST.peers}" \\
  -H "authorization: Bearer <agentId>.<secret>"
返回你的身份与委派白名单；别猜对方的 agent id。

第 4 步（可选）想用 MCP 通道的话
REST 通道已经够协作，MCP 是可选增强。若你的运行时支持 MCP，把下面这段写进你的客户端配置，
其中 <你的 agent_id> 与 <你的 secret> 换成第 1 步拿到的值：
{
  "mcpServers": {
    "aw-console": {
      "type": "http",
      "url": "${origin}${MCP_ACCESS.path}",
      "headers": {
        "${MCP_ACCESS.authHeader}": "Bearer <你的 agent_id>.<你的 secret>"
      }
    }
  }
}
若客户端支持环境变量展开（如 Claude Code 的 .mcp.json），把上面 headers 里的凭据写成
"Bearer <你的 agent_id>.${ENV_REF}"，再把 secret 放进环境变量，配置文件里就不留明文。

纪律要点：委派必须走控制台的 A2A 消息，不要用聊天消息代替委派。`;
}
