import { formatDateTime } from "../../shared/format.js";
import { CopyBlock } from "../ui/CopyBlock.js";
import { Dialog } from "../ui/Dialog.js";
import { enrollPackage } from "./snippets.js";
import type { AgentEnrollGrant } from "./types.js";
import styles from "./access.module.css";

export interface EnrollDialogProps {
  grant: AgentEnrollGrant;
  /** 控制台对外地址(不含尾斜杠) */
  origin: string;
  onClose: () => void;
}

/**
 * 接入包弹窗:签发后立刻把「能直接粘给 Agent 的那一段」交到人手上,
 * 不让人自己在页面里拼令牌和命令。
 */
export function EnrollDialog({ grant, origin, onClose }: EnrollDialogProps) {
  const packageText = enrollPackage(origin, grant.displayName, grant.token);
  return (
    <Dialog
      title="接入包已生成"
      description="整段复制发给 Agent,它自己换密钥、拉规范、查可委派目标。"
      size="lg"
      onClose={onClose}
    >
      <div className={styles.snippets}>
        <p className={styles.warning} role="alert">
          令牌只显示这一次，有效期到 {formatDateTime(grant.expiresAt)}、只能用一次。它等同密码，别发到公开频道；
          兑换时 {grant.displayName} 的旧密钥会立即作废。
        </p>
        <CopyBlock
          label="整段发给 Agent"
          value={packageText}
          copyLabel="复制接入包"
          copiedText="接入包已复制，粘给 Agent 即可"
          note="这一段已包含控制台地址、令牌与三步命令；Agent 不需要你再改任何客户端配置。"
        />
        <CopyBlock
          label="只要令牌"
          value={grant.token}
          note="Agent 已经知道控制台地址、只想自己写接入步骤时才用这块。"
        />
      </div>
    </Dialog>
  );
}
