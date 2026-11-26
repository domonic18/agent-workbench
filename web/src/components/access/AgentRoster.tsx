import { KeyRound, Ticket } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../api/client.js";
import { issueAgentEnrollToken, type AgentRosterSummary } from "../../api/identity.js";
import { AgentRegisterDialog } from "../identity/AgentRegisterDialog.js";
import { AgentRotateDialog } from "../identity/AgentRotateDialog.js";
import { RUNTIME_LABEL } from "../../shared/labels.js";
import { NARROW_QUERY, useMediaQuery } from "../../shared/useMediaQuery.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Table } from "../ui/Table.js";
import { useToast } from "../ui/Toast.js";
import type { AgentCredentials, AgentEnrollGrant } from "./types.js";

const roster = "flex flex-col gap-3";
const cardList = "m-0 flex list-none flex-col gap-3 p-0";
const card = "flex flex-col gap-2 rounded-md border border-border bg-surface-2 px-4 py-3";
const cardTop = "flex items-center justify-between gap-2";
const cardName = "text-md font-semibold text-foreground";
const cardMeta = "flex flex-wrap gap-x-3 gap-y-2 text-xs text-muted [overflow-wrap:anywhere]";
const rowActions = "flex flex-wrap gap-2";
const rosterActions = "flex justify-end";
const hint = "m-0 mt-3 text-sm text-muted";

export interface AgentRosterProps {
  /** 名册由页面统一取数,便于与密钥状态共用一次请求 */
  agents: AgentRosterSummary[];
  /** 拿到明文密钥后回调,页面据此渲染配置片段 */
  onCredentials: (credentials: AgentCredentials) => void;
  /** 签发接入令牌后回调,页面据此渲染自助接入步骤 */
  onEnroll: (grant: AgentEnrollGrant) => void;
}

/** Agent 名册:登记、查看与轮换密钥 */
export function AgentRoster({ agents, onCredentials, onEnroll }: AgentRosterProps) {
  const [rotating, setRotating] = useState<AgentRosterSummary | null>(null);
  const [registering, setRegistering] = useState(false);
  const [issuing, setIssuing] = useState<string | null>(null);
  const narrow = useMediaQuery(NARROW_QUERY);
  const toast = useToast();

  async function issueEnrollToken(agent: AgentRosterSummary): Promise<void> {
    setIssuing(agent.id);
    try {
      const issued = await issueAgentEnrollToken(agent.id);
      onEnroll({
        agentId: issued.agentId,
        displayName: agent.displayName,
        token: issued.token,
        expiresAt: issued.expiresAt,
      });
      toast.push(`已为 ${agent.displayName} 生成接入包`, "positive");
    } catch (error) {
      toast.push(
        error instanceof ApiError ? error.message : "接入令牌签发失败",
        "danger",
      );
    } finally {
      setIssuing(null);
    }
  }

  const enrollButton = (agent: AgentRosterSummary) => (
    <Button
      size="sm"
      variant="secondary"
      className="max-md:flex-1"
      icon={<Ticket size={14} aria-hidden="true" />}
      disabled={issuing === agent.id}
      onClick={() => void issueEnrollToken(agent)}
    >
      签发接入令牌
    </Button>
  );

  return (
    <>
      <div className={roster}>
        {narrow ? (
          <ul className={cardList} aria-label="Agent 卡片">
            {agents.map((agent) => (
              <li key={agent.id} className={card}>
                <div className={cardTop}>
                  <span className={cardName}>{agent.displayName}</span>
                  <Badge
                    tone={agent.status === "active" ? "positive" : "muted"}
                    text={agent.status === "active" ? "启用" : "停用"}
                  />
                </div>
                <div className={cardMeta}>
                  <span>{RUNTIME_LABEL[agent.runtime]}</span>
                  <span>{agent.project}</span>
                  <code>{agent.id}</code>
                </div>
                <div className={rowActions}>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="max-md:flex-1"
                    icon={<KeyRound size={14} aria-hidden="true" />}
                    onClick={() => setRotating(agent)}
                  >
                    轮换密钥
                  </Button>
                  {enrollButton(agent)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Table
            columns={[
              { key: "name", header: "名称", render: (row) => row.displayName, plain: true },
              { key: "runtime", header: "运行时", render: (row) => RUNTIME_LABEL[row.runtime] },
              { key: "id", header: "Agent ID", render: (row) => <code>{row.id}</code> },
              { key: "project", header: "项目", render: (row) => row.project },
              {
                key: "status",
                header: "状态",
                render: (row) => (
                  <Badge
                    tone={row.status === "active" ? "positive" : "muted"}
                    text={row.status === "active" ? "启用" : "停用"}
                  />
                ),
              },
              {
                key: "actions",
                header: "操作",
                render: (row) => (
                  <div className={rowActions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="max-md:flex-1"
                      icon={<KeyRound size={14} aria-hidden="true" />}
                      onClick={() => setRotating(row)}
                    >
                      轮换密钥
                    </Button>
                    {enrollButton(row)}
                  </div>
                ),
              },
            ]}
            rows={agents}
            rowKey={(row) => row.id}
            empty={<p className={hint}>还没有登记 Agent。点「注册新 Agent」建一个。</p>}
          />
        )}
        <div className={rosterActions}>
          <Button variant="primary" className="max-md:w-full" onClick={() => setRegistering(true)}>
            注册新 Agent
          </Button>
        </div>
      </div>

      {rotating === null ? null : (
        <AgentRotateDialog
          agent={rotating}
          onClose={() => setRotating(null)}
          onRotated={(secret) =>
            onCredentials({
              agentId: rotating.id,
              displayName: rotating.displayName,
              secret,
            })
          }
        />
      )}

      {registering ? (
        <AgentRegisterDialog
          onClose={() => setRegistering(false)}
          onCreated={(created) =>
            onCredentials({
              agentId: created.agent.id,
              displayName: created.agent.displayName,
              secret: created.secret,
            })
          }
        />
      ) : null}
    </>
  );
}
