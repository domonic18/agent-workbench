import { formatDateTime } from "../../shared/format.js";
import { CopyBlock } from "../ui/CopyBlock.js";
import { Dialog } from "../ui/Dialog.js";
import { enrollPackage } from "./snippets.js";
import type { AgentEnrollGrant } from "./types.js";

const snippets = "flex flex-col gap-4";
const warning =
  "m-0 rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-foreground";

export interface EnrollDialogProps {
  grant: AgentEnrollGrant;
  /** 控制台对外地址(不含尾斜杠) */
  origin: string;
  onClose: () => void;
}

export function EnrollDialog({ grant, origin, onClose }: EnrollDialogProps) {
  const packageText = enrollPackage(origin, grant.displayName, grant.token);
  return (
    <Dialog title="接入包已生成" size="lg" onClose={onClose}>
      <div className={snippets}>
        <p className={warning} role="alert">
          令牌只显示这一次，有效期到 {formatDateTime(grant.expiresAt)}、只能用一次。它等同密码，别发到公开频道；
          兑换时 {grant.displayName} 的旧密钥会立即作废。
        </p>
        <CopyBlock
          label="整段发给 Agent"
          value={packageText}
          copyLabel="复制接入包"
          copiedText="接入包已复制，粘给 Agent 即可"
        />
        <CopyBlock label="只要令牌" value={grant.token} />
      </div>
    </Dialog>
  );
}
