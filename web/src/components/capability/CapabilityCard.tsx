import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  approveCapability,
  type CapabilityCreateInput,
  type CapabilityDto,
  type CapabilityView,
  createCapability,
  rejectCapability,
  revokeCapability,
} from "../../api/capabilities.js";
import { ApiError } from "../../api/client.js";
import { CAPABILITY_STATUS_LABEL, CAPABILITY_STATUS_TONE } from "../../shared/labels.js";
import { formatDateTime, formatDuration } from "../../shared/format.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Panel.js";
import styles from "./CapabilityCard.module.css";

export interface CapabilityCardProps {
  capability: CapabilityDto;
  view: CapabilityView;
  now: number;
}

function toCreateInput(capability: CapabilityDto): CapabilityCreateInput {
  return {
    subject: capability.subject,
    target: capability.target,
    action: capability.action,
    scope: capability.scope,
    ttlSeconds: capability.ttlSeconds,
    taskId: capability.taskId,
  };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** 签发失败的终态是 rejected;重试 = 用原参数重新申请一条 pending */
function isIssueFailure(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 503 || error.code === "UPSTREAM_UNAVAILABLE");
}

export function CapabilityCard({ capability, view, now }: CapabilityCardProps) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issueFailed, setIssueFailed] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["capabilities"] });
  };

  async function run(
    action: () => Promise<unknown>,
    fallback: string,
    issueOnFailure = false,
  ): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await action();
      refresh();
    } catch (caught) {
      if (issueOnFailure && isIssueFailure(caught)) {
        setIssueFailed(true);
      } else {
        setError(messageOf(caught, fallback));
      }
    } finally {
      setPending(false);
    }
  }

  const handleApprove = (): void => {
    void run(() => approveCapability(capability.id), "批准失败，请稍后再试", true);
  };
  const handleReject = (): void => {
    void run(() => rejectCapability(capability.id), "拒绝失败，请稍后再试");
  };
  const handleRevoke = (): void => {
    if (!confirmRevoke) {
      setConfirmRevoke(true);
      return;
    }
    setConfirmRevoke(false);
    void run(() => revokeCapability(capability.id), "吊销失败，请稍后再试");
  };
  const handleRetry = (): void => {
    setIssueFailed(false);
    void run(() => createCapability(toCreateInput(capability)), "重新申请失败，请稍后再试");
  };

  const remaining = capability.expiresAt === null ? null : capability.expiresAt - now;
  const revoked = capability.status === "revoked";

  return (
    <Card className={styles.card}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h3 className={styles.target}>{capability.target}</h3>
          <Badge tone="info" text={capability.action} />
        </div>
        <Badge
          tone={CAPABILITY_STATUS_TONE[capability.status]}
          text={CAPABILITY_STATUS_LABEL[capability.status]}
        />
      </header>

      <dl className={styles.meta}>
        <div className={styles.metaItem}>
          <dt>申请人</dt>
          <dd>{capability.subject}</dd>
        </div>
        <div className={styles.metaItem}>
          <dt>任务</dt>
          <dd className={styles.mono}>{capability.taskId}</dd>
        </div>
        <div className={styles.metaItem}>
          <dt>TTL</dt>
          <dd>{formatDuration(capability.ttlSeconds * 1000)}</dd>
        </div>
        {remaining === null ? null : (
          <div className={styles.metaItem}>
            <dt>剩余有效期</dt>
            <dd>{remaining > 0 ? formatDuration(remaining) : "已过期"}</dd>
          </div>
        )}
        {capability.expiresAt === null ? null : (
          <div className={styles.metaItem}>
            <dt>到期</dt>
            <dd>{formatDateTime(capability.expiresAt)}</dd>
          </div>
        )}
        {revoked && capability.revokedAt !== null ? (
          <div className={styles.metaItem}>
            <dt>吊销于</dt>
            <dd>{formatDateTime(capability.revokedAt)}</dd>
          </div>
        ) : null}
        {view === "history" ? (
          <div className={styles.metaItem}>
            <dt>创建</dt>
            <dd>{formatDateTime(capability.createdAt)}</dd>
          </div>
        ) : null}
      </dl>

      <section className={styles.scopeSection} aria-label="授权范围">
        <h4 className={styles.scopeTitle}>范围（完整展示，不折叠）</h4>
        <pre className={styles.scope}>{JSON.stringify(capability.scope, null, 2)}</pre>
      </section>

      {error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {view === "pending" ? (
        <div className={styles.actions}>
          {issueFailed ? (
            <div className={styles.failure}>
              <span>签发失败，可重试；当前未生效。</span>
              <div className={styles.failureActions}>
                <Button variant="primary" onClick={handleRetry}>
                  重试
                </Button>
                <Button variant="secondary" onClick={() => setIssueFailed(false)}>
                  知道了
                </Button>
              </div>
            </div>
          ) : capability.status === "issuing" ? (
            <>
              <Button variant="primary" disabled>
                签发中…
              </Button>
              <Button variant="secondary" disabled>
                拒绝
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                onClick={handleApprove}
                disabled={pending}
                loading={pending}
              >
                {pending ? "签发中…" : "批准"}
              </Button>
              <Button
                variant="secondary"
                onClick={handleReject}
                disabled={pending}
              >
                拒绝
              </Button>
            </>
          )}
        </div>
      ) : null}

      {view === "active" ? (
        <div className={styles.actions}>
          <Button
            variant={confirmRevoke ? "danger" : "secondary"}
            onClick={handleRevoke}
            disabled={pending}
          >
            {confirmRevoke ? "确认吊销" : "吊销"}
          </Button>
          {confirmRevoke ? (
            <Button variant="secondary" onClick={() => setConfirmRevoke(false)}>
              取消
            </Button>
          ) : null}
        </div>
      ) : null}

      {view === "history" && capability.status === "rejected" ? (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleRetry} disabled={pending}>
            {pending ? "申请中…" : "重新申请"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
