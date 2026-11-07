import { KeyRound } from "lucide-react";
import { useState } from "react";
import { type AgentRosterSummary } from "../../api/identity.js";
import { AgentRegisterDialog } from "../identity/AgentRegisterDialog.js";
import { AgentRotateDialog } from "../identity/AgentRotateDialog.js";
import { RUNTIME_LABEL } from "../../shared/labels.js";
import { NARROW_QUERY, useMediaQuery } from "../../shared/useMediaQuery.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Table } from "../ui/Table.js";
import type { AgentCredentials } from "./types.js";
import styles from "./access.module.css";

export interface AgentRosterProps {
  /** 名册由页面统一取数,便于与密钥状态共用一次请求 */
  agents: AgentRosterSummary[];
  /** 拿到明文密钥后回调,页面据此渲染配置片段 */
  onCredentials: (credentials: AgentCredentials) => void;
}

/** Agent 名册:登记、查看与轮换密钥 */
export function AgentRoster({ agents, onCredentials }: AgentRosterProps) {
  const [rotating, setRotating] = useState<AgentRosterSummary | null>(null);
  const [registering, setRegistering] = useState(false);
  const narrow = useMediaQuery(NARROW_QUERY);

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
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<KeyRound size={14} aria-hidden="true" />}
                  onClick={() => setRotating(agent)}
                >
                  轮换密钥
                </Button>
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
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<KeyRound size={14} aria-hidden="true" />}
                    onClick={() => setRotating(row)}
                  >
                    轮换密钥
                  </Button>
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
