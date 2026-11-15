import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { AgentSummary } from "../../api/identity.js";
import { agentDisplayName } from "../../shared/agent-label.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";
import type { AgentGroupsApi } from "./useAgentGroups.js";
import styles from "./GroupPanel.module.css";

export interface GroupPanelProps {
  groupsApi: AgentGroupsApi;
  agents: AgentSummary[];
}

/**
 * 委派目标组的管理:建组、改名、增删成员、删组。
 *
 * 组的成员变更即时落库(它是独立实体);「谁能委派给谁」仍走委派草稿统一保存。
 */
export function GroupPanel({ groupsApi, agents }: GroupPanelProps) {
  const { groups, pending, error } = groupsApi;
  const [newName, setNewName] = useState("");
  const [names, setNames] = useState<Record<string, string>>({});

  const nameOf = new Map(agents.map((agent) => [agent.id, agentDisplayName(agent)]));

  async function createGroup(): Promise<void> {
    const name = newName.trim();
    if (name === "") return;
    await groupsApi.create(name, []);
    setNewName("");
  }

  return (
    <div className={styles.panel} role="group" aria-label="委派目标组">
      <div className={styles.createRow}>
        <input
          className={styles.input}
          value={newName}
          placeholder="新组名，如「CC 三兄弟」"
          aria-label="新组名"
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void createGroup();
            }
          }}
        />
        <Button variant="primary" disabled={pending || newName.trim() === ""} onClick={() => void createGroup()}>
          新建组
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className={styles.empty}>
          还没有组。组把一组 Agent 收成一个收件方——「谁能被这个 Agent 委派」一次配好，不用逐个勾。
        </p>
      ) : (
        <ul className={styles.list}>
          {groups.map((group) => {
            const draftName = names[group.id] ?? group.name;
            const members = group.memberIds
              .map((id) => nameOf.get(id))
              .filter((name): name is string => name !== undefined);
            const candidates = agents.filter((agent) => !group.memberIds.includes(agent.id));
            return (
              <li key={group.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <input
                    className={styles.input}
                    value={draftName}
                    aria-label={`组名 ${group.name}`}
                    onChange={(event) =>
                      setNames({ ...names, [group.id]: event.target.value })
                    }
                    onBlur={() => {
                      const next = draftName.trim();
                      if (next !== "" && next !== group.name) {
                        void groupsApi.update(group.id, { name: next });
                      }
                    }}
                  />
                  <IconButton
                    label={`删除组 ${group.name}`}
                    icon={<Trash2 size={14} />}
                    onClick={() => void groupsApi.remove(group.id)}
                  />
                </div>
                <div className={styles.chips}>
                  {members.length === 0 ? (
                    <span className={styles.chipsEmpty}>暂无成员</span>
                  ) : (
                    members.map((name, index) => (
                      <span key={group.memberIds[index] ?? name} className={styles.chip}>
                        {name}
                        <button
                          type="button"
                          className={styles.chipRemove}
                          aria-label={`从 ${group.name} 移除 ${name}`}
                          onClick={() =>
                            void groupsApi.update(group.id, {
                              memberIds: group.memberIds.filter(
                                (id) => id !== group.memberIds[index],
                              ),
                            })
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>
                {candidates.length === 0 ? null : (
                  <label className={styles.addLabel}>
                    加入成员
                    <select
                      className={styles.select}
                      value=""
                      onChange={(event) => {
                        if (event.target.value === "") return;
                        void groupsApi.update(group.id, {
                          memberIds: [...group.memberIds, event.target.value],
                        });
                      }}
                    >
                      <option value="" disabled>
                        选择 Agent
                      </option>
                      {candidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {agentDisplayName(candidate)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
