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
import { CapabilityFlow } from "./CapabilityFlow.js";

const card =
  "flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface p-4 transition-colors duration-fast hover:border-border-hover";
const header = "flex items-start justify-between gap-3";
const meta = "m-0 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-2";
const metaItem = "flex min-w-0 flex-col gap-1";
const metaDt = "text-xs text-muted";
const metaDd = "m-0 text-sm text-foreground [overflow-wrap:anywhere]";
const monoClass = "font-mono text-xs text-subtle";
const scopeSection = "flex flex-col gap-2";
const scopeTitle = "m-0 text-sm font-semibold text-text-secondary";
const scope =
  "m-0 max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-line-soft bg-surface-2 p-3 font-mono text-xs leading-normal text-foreground";
const errorClass = "m-0 text-sm text-danger";
const actions = "flex flex-wrap gap-2";
const failure =
  "flex flex-col gap-2 rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-warning";
const failureActions = "flex gap-2";

export interface CapabilityCardProps {
  capability: CapabilityDto;
  view: CapabilityView;
  now: number;
  /** 名册解析出的申请人显示名;查不到为 null(卡片头回落 subject 原文) */
  subjectName?: string | null;
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

export function CapabilityCard({ capability, view, now, subjectName = null }: CapabilityCardProps) {
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
    <Card className={card}>
      <header className={header}>
        <CapabilityFlow
          subject={capability.subject}
          subjectName={subjectName}
          action={capability.action}
          target={capability.target}
          status={capability.status}
        />
        <Badge
          tone={CAPABILITY_STATUS_TONE[capability.status]}
          text={CAPABILITY_STATUS_LABEL[capability.status]}
        />
      </header>

      <dl className={meta}>
        <div className={metaItem}>
          <dt className={metaDt}>申请人</dt>
          <dd className={metaDd}>{capability.subject}</dd>
        </div>
        <div className={metaItem}>
          <dt className={metaDt}>任务</dt>
          <dd className={`${monoClass} ${metaDd}`}>{capability.taskId}</dd>
        </div>
        <div className={metaItem}>
          <dt className={metaDt}>TTL</dt>
          <dd className={metaDd}>{formatDuration(capability.ttlSeconds * 1000)}</dd>
        </div>
        {remaining === null ? null : (
          <div className={metaItem}>
            <dt className={metaDt}>剩余有效期</dt>
            <dd className={metaDd}>{remaining > 0 ? formatDuration(remaining) : "已过期"}</dd>
          </div>
        )}
        {capability.expiresAt === null ? null : (
          <div className={metaItem}>
            <dt className={metaDt}>到期</dt>
            <dd className={metaDd}>{formatDateTime(capability.expiresAt)}</dd>
          </div>
        )}
        {revoked && capability.revokedAt !== null ? (
          <div className={metaItem}>
            <dt className={metaDt}>吊销于</dt>
            <dd className={metaDd}>{formatDateTime(capability.revokedAt)}</dd>
          </div>
        ) : null}
        {view === "history" ? (
          <div className={metaItem}>
            <dt className={metaDt}>创建</dt>
            <dd className={metaDd}>{formatDateTime(capability.createdAt)}</dd>
          </div>
        ) : null}
      </dl>

      <section className={scopeSection} aria-label="授权范围">
        <h4 className={scopeTitle}>范围（完整展示，不折叠）</h4>
        <pre className={scope}>{JSON.stringify(capability.scope, null, 2)}</pre>
      </section>

      {error === null ? null : (
        <p className={errorClass} role="alert">
          {error}
        </p>
      )}

      {view === "pending" ? (
        <div className={actions}>
          {issueFailed ? (
            <div className={failure}>
              <span>签发失败，可重试；当前未生效。</span>
              <div className={failureActions}>
                <Button className="max-md:flex-1" variant="primary" onClick={handleRetry}>
                  重试
                </Button>
                <Button className="max-md:flex-1" variant="secondary" onClick={() => setIssueFailed(false)}>
                  知道了
                </Button>
              </div>
            </div>
          ) : capability.status === "issuing" ? (
            <>
              <Button className="max-md:flex-1" variant="primary" disabled>
                签发中…
              </Button>
              <Button className="max-md:flex-1" variant="secondary" disabled>
                拒绝
              </Button>
            </>
          ) : (
            <>
              <Button
                className="max-md:flex-1"
                variant="primary"
                onClick={handleApprove}
                disabled={pending}
                loading={pending}
              >
                {pending ? "签发中…" : "批准"}
              </Button>
              <Button
                className="max-md:flex-1"
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
        <div className={actions}>
          <Button
            className="max-md:flex-1"
            variant={confirmRevoke ? "danger" : "secondary"}
            onClick={handleRevoke}
            disabled={pending}
          >
            {confirmRevoke ? "确认吊销" : "吊销"}
          </Button>
          {confirmRevoke ? (
            <Button className="max-md:flex-1" variant="secondary" onClick={() => setConfirmRevoke(false)}>
              取消
            </Button>
          ) : null}
        </div>
      ) : null}

      {view === "history" && capability.status === "rejected" ? (
        <div className={actions}>
          <Button className="max-md:flex-1" variant="secondary" onClick={handleRetry} disabled={pending}>
            {pending ? "申请中…" : "重新申请"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
