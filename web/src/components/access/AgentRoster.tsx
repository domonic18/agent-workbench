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
import styles from "./access.module.css";

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
      toast.push(`已签发 ${agent.displayName} 的接入令牌`, "positive");
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
      icon={<Ticket size={14} aria-hidden="true" />}
      disabled={issuing === agent.id}
      onClick={() => void issueEnrollToken(agent)}
    >
      签发接入令牌
    </Button>
  );

  return (
    <>
      <div className={styles.roster}>
        {narrow ? (
          <ul className={styles.cardList} aria-label="Agent 卡片">
            {agents.map((agent) => (
              <li key={agent.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <span className={styles.cardName}>{agent.displayName}</span>
                  <Badge
                    tone={agent.status === "active" ? "positive" : "muted"}
                    text={agent.status === "active" ? "启用" : "停用"}
                  />
                </div>
                <div className={styles.cardMeta}>
                  <span>{RUNTIME_LABEL[agent.runtime]}</span>
                  <span>{agent.project}</span>
                  <code>{agent.id}</code>
                </div>
                <div className={styles.rowActions}>
                  <Button
                    size="sm"
                    variant="secondary"
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
                  <div className={styles.rowActions}>
                    <Button
                      size="sm"
                      variant="secondary"
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
            empty={<p className={styles.hint}>还没有登记 Agent。点「注册新 Agent」建一个。</p>}
          />
        )}
        <div className={styles.rosterActions}>
          <Button variant="primary" onClick={() => setRegistering(true)}>
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
