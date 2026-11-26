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
import { MARKDOWN_CLASS } from "../components/markdown/markdown.js";

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
    <div className="flex flex-col gap-5">
      <Panel
        title="A2A 协作规范"
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
          <div className={MARKDOWN_CLASS} data-testid="agent-guide-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{guide}</ReactMarkdown>
          </div>
        </AsyncSection>
      </Panel>

      <Panel title="工作区提示词">
        <AsyncSection {...loadState} hasMore={false} fetchingMore={false} onLoadMore={() => undefined}>
          {prompts === undefined ? null : (
            <div className="flex flex-col gap-4">
              <CopyBlock label="接收侧" value={prompts.receiver} />
              <CopyBlock label="发起侧" value={prompts.senderTemplate} />
            </div>
          )}
        </AsyncSection>
      </Panel>
    </div>
  );
}
