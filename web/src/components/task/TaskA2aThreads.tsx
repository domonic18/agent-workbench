import type { A2aMessage, A2aThread } from "../../api/tasks.js";
import { agentMentionLabel } from "../../shared/agent-label.js";
import { formatDateTime } from "../../shared/format.js";
import {
  A2A_INTENT_LABEL,
  A2A_THREAD_STATUS_LABEL,
  A2A_THREAD_STATUS_TONE,
  DELIVERY_STATUS_LABEL,
  DELIVERY_STATUS_TONE,
} from "../../shared/labels.js";
import { Badge } from "../ui/Badge.js";
import {
  loading as sharedLoading,
  muted as sharedMuted,
  outputCode as sharedOutputCode,
} from "./shared.js";

export interface TaskA2aThreadsProps {
  threads: readonly A2aThread[];
  loading: boolean;
  error: string | null;
  agentNames: ReadonlyMap<string, string>;
}

export function TaskA2aThreads({ threads, loading, error, agentNames }: TaskA2aThreadsProps) {
  function agentLabel(id: string): string {
    return agentMentionLabel(id, agentNames, id);
  }

  return (
    <div className="flex flex-col gap-3" aria-label="A2A 线程">
      {loading ? <p className={sharedLoading}>加载 A2A 线程…</p> : null}
      {error === null ? null : <p className="text-xs text-warning">{error}</p>}
      {!loading && error === null && threads.length === 0 ? (
        <p className={sharedMuted}>该任务没有 A2A 往返。</p>
      ) : null}
      {threads.map((thread) => (
        <article
          key={thread.thread_id}
          className="border-t border-line-soft pt-2 first:border-t-0 first:pt-0"
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-subtle">
              {agentLabel(thread.initiator_agent)} → {agentLabel(thread.responder_agent)} ·{" "}
              {formatDateTime(thread.created_at)}
            </span>
            <Badge
              tone={A2A_THREAD_STATUS_TONE[thread.status]}
              text={A2A_THREAD_STATUS_LABEL[thread.status]}
            />
          </div>
          <div className="relative pl-4 before:absolute before:top-1 before:bottom-1 before:left-1 before:w-px before:bg-line-soft before:content-['']">
            {thread.messages.map((message) => (
              <Message key={message.msg_id} message={message} agentLabel={agentLabel} />
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function Message({
  message,
  agentLabel,
}: {
  message: A2aMessage;
  agentLabel: (id: string) => string;
}) {
  return (
    <div className="relative pb-2 last:pb-0 before:absolute before:top-1 before:-left-4 before:h-1 before:w-1 before:rounded-full before:border before:border-border before:bg-surface before:content-[''] first:before:border-accent first:before:bg-accent">
      <div className="flex flex-wrap items-baseline gap-1 text-2xs text-subtle">
        <span>{formatDateTime(message.created_at)}</span>
        <span className="text-border">·</span>
        <span>{A2A_INTENT_LABEL[message.intent]}</span>
        <span className="text-border">·</span>
        <span>第 {message.round} 轮</span>
      </div>
      <div className="mt-px text-xs font-semibold text-text-secondary">
        {agentLabel(message.from)} → {agentLabel(message.to)}
      </div>
      <div className="text-xs text-foreground [overflow-wrap:anywhere] before:text-muted before:content-['：']">
        {message.summary}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
        {message.expect === "" ? null : <span>期望：{message.expect}</span>}
        {message.deadline_at === null ? null : (
          <span>截止：{formatDateTime(message.deadline_at)}</span>
        )}
        <span>
          ACK：
          {message.ack_at === null ? "未确认" : formatDateTime(message.ack_at)}
        </span>
        <span>
          投递：
          {message.delivery === null ? (
            "未入队"
          ) : (
            <>
              <Badge
                tone={DELIVERY_STATUS_TONE[message.delivery.status]}
                text={DELIVERY_STATUS_LABEL[message.delivery.status]}
              />
              {message.delivery.attempts > 0 ? ` · 尝试 ${message.delivery.attempts} 次` : ""}
              {message.delivery.last_error === null
                ? ""
                : ` · ${message.delivery.last_error}`}
            </>
          )}
        </span>
      </div>
      {message.refs.length === 0 ? null : (
        <div className="mt-1 text-2xs text-muted">
          引用：
          <ul className="m-0 pl-4">
            {message.refs.map((ref) => (
              <li key={ref} className="mb-1">
                <code className={sharedOutputCode}>{ref}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {message.auth_ticket === null ? null : (
        <div className="mt-1 text-2xs text-muted">
          凭证标识：<code className={sharedOutputCode}>{message.auth_ticket}</code>
        </div>
      )}
    </div>
  );
}
