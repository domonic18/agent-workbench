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
import styles from "./task-a2a.module.css";

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
    <div className={styles.threads} aria-label="A2A 线程">
      {loading ? <p className={styles.loading}>加载 A2A 线程…</p> : null}
      {error === null ? null : <p className={styles.threadMissing}>{error}</p>}
      {!loading && error === null && threads.length === 0 ? (
        <p className={styles.muted}>该任务没有 A2A 往返。</p>
      ) : null}
      {threads.map((thread) => (
        <article key={thread.thread_id} className={styles.thread}>
          <div className={styles.threadHeader}>
            <span className={styles.participants}>
              {agentLabel(thread.initiator_agent)} → {agentLabel(thread.responder_agent)} ·{" "}
              {formatDateTime(thread.created_at)}
            </span>
            <Badge
              tone={A2A_THREAD_STATUS_TONE[thread.status]}
              text={A2A_THREAD_STATUS_LABEL[thread.status]}
            />
          </div>
          <div className={styles.messages}>
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
    <div className={styles.message}>
      <div className={styles.messageStamp}>
        <span>{formatDateTime(message.created_at)}</span>
        <span className={styles.sep}>·</span>
        <span>{A2A_INTENT_LABEL[message.intent]}</span>
        <span className={styles.sep}>·</span>
        <span>第 {message.round} 轮</span>
      </div>
      <div className={styles.messageFrom}>
        {agentLabel(message.from)} → {agentLabel(message.to)}
      </div>
      <div className={styles.messageBody}>{message.summary}</div>
      <div className={styles.messageMeta}>
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
        <div className={styles.refs}>
          引用：
          <ul className={styles.refList}>
            {message.refs.map((ref) => (
              <li key={ref} className={styles.refItem}>
                <code className={styles.outputCode}>{ref}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {message.auth_ticket === null ? null : (
        <div className={styles.refs}>
          凭证标识：<code className={styles.outputCode}>{message.auth_ticket}</code>
        </div>
      )}
    </div>
  );
}
