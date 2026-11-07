import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchAgentKit } from "../api/agent-kit.js";
import { ApiError } from "../api/client.js";
import { CopyActionButton, CopyBlock } from "../components/ui/CopyBlock.js";
import { AsyncSection } from "../components/ui/AsyncSection.js";
import { LinkButton } from "../components/ui/LinkButton.js";
import { Panel } from "../components/ui/Panel.js";
import markdownStyles from "../components/markdown/markdown.module.css";
import styles from "./AgentGuidePage.module.css";

/**
 * Agent 手册：把 A2A 协作规范交给 Agent 自己读。
 * 规范正文与工具速查表由服务端从真实工具注册表生成，改工具不用改这里。
 */
export function AgentGuidePage() {
  const kit = useQuery({
    queryKey: ["agent-kit"],
    queryFn: fetchAgentKit,
    retry: (count, caught) =>
      !(caught instanceof ApiError && caught.status === 401) && count < 2,
  });

  const guide = kit.data?.guide ?? "";
  const prompts = kit.data?.prompts;
  const loadState = {
    pending: kit.isPending,
    error:
      kit.isError
        ? kit.error instanceof ApiError
          ? kit.error.message
          : "协作规范加载失败"
        : null,
    onRetry: () => void kit.refetch(),
  };

  return (
    <div className={styles.page}>
      <Panel
        title="A2A 协作规范"
        description="Agent 自己读的规范正文：角色、消息信封、回执纪律、任务状态机与工具速查表。"
        actions={
          <>
            <CopyActionButton
              value={guide}
              label="复制全文"
              copiedText="规范全文已复制"
              disabled={guide === ""}
            />
            <LinkButton
              href="/api/agent-kit/skill"
              download="SKILL.md"
              icon={<Download size={14} aria-hidden="true" />}
            >
              下载 SKILL.md
            </LinkButton>
          </>
        }
      >
        <AsyncSection {...loadState} hasMore={false} fetchingMore={false} onLoadMore={() => undefined}>
          <div className={markdownStyles.markdown} data-testid="agent-guide-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{guide}</ReactMarkdown>
          </div>
        </AsyncSection>
      </Panel>

      <Panel
        title="工作区提示词"
        description="贴进对方运行时的工作区提示词，Agent 一上手就知道按哪几步走。文本与规范同源。"
      >
        <AsyncSection {...loadState} hasMore={false} fetchingMore={false} onLoadMore={() => undefined}>
          {prompts === undefined ? null : (
            <div className={styles.prompts}>
              <CopyBlock
                label="接收侧：负责接活并回执"
                value={prompts.receiver}
                note="贴给承接委派的一方，它会按六步协议取件、回执与收口。"
              />
              <CopyBlock
                label="发起侧：负责委派与确认"
                value={prompts.senderTemplate}
                note="发起侧把具体参数换成自己的任务上下文后贴出。"
              />
            </div>
          )}
        </AsyncSection>
      </Panel>
    </div>
  );
}
