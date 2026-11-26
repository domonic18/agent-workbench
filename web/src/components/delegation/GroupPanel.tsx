import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { AgentSummary } from "../../api/identity.js";
import { agentDisplayName } from "../../shared/agent-label.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";
import type { AgentGroupsApi } from "./useAgentGroups.js";

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
    <div className={"flex flex-col gap-3 p-4 border border-border rounded-lg bg-surface"} role="group" aria-label="委派目标组">
      <div className={"flex flex-wrap items-center gap-2"}>
        <input
          className={"px-2 py-1 border border-border-strong rounded-md bg-surface text-foreground text-sm min-w-[180px] flex-1"}
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
        <p className={"m-0 text-sm text-muted"}>
          还没有组。组把一组 Agent 收成一个收件方——「谁能被这个 Agent 委派」一次配好，不用逐个勾。
        </p>
      ) : (
        <ul className={"flex flex-col gap-3 m-0 p-0 list-none"}>
          {groups.map((group) => {
            const draftName = names[group.id] ?? group.name;
            const members = group.memberIds
              .map((id) => nameOf.get(id))
              .filter((name): name is string => name !== undefined);
            const candidates = agents.filter((agent) => !group.memberIds.includes(agent.id));
            return (
              <li key={group.id} className={"flex flex-col gap-2 p-3 border border-border rounded-md"}>
                <div className={"flex items-center gap-2"}>
                  <input
                    className={"px-2 py-1 border border-border-strong rounded-md bg-surface text-foreground text-sm min-w-[180px] flex-1"}
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
                <div className={"flex flex-wrap gap-2"}>
                  {members.length === 0 ? (
                    <span className={"text-sm text-muted"}>暂无成员</span>
                  ) : (
                    members.map((name, index) => (
                      <span key={group.memberIds[index] ?? name} className={"inline-flex items-center gap-1 px-2 py-1 border border-accent-border rounded-full bg-accent-soft text-foreground text-sm"}>
                        {name}
                        <button
                          type="button"
                          className={"inline-flex items-center justify-center w-[18px] h-[18px] p-0 border-none rounded-full bg-transparent text-muted cursor-pointer hover:text-danger"}
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
                  <label className={"inline-flex items-center gap-2 text-sm text-text-secondary"}>
                    加入成员
                    <select
                      className={"px-2 py-1 border border-border-strong rounded-md bg-surface text-foreground text-sm"}
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
        <p className={"m-0 text-sm text-danger"} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
