import { MCP_ACCESS } from "@shared/constants.js";
import { Panel } from "../ui/Panel.js";
import styles from "./access.module.css";

/**
 * 两条接入路径的对照:先说清「谁来配客户端、谁拿凭据」,
 * 再让人去点按钮,免得把「签发令牌」和「轮换密钥」当成一回事。
 */
export function AccessPaths() {
  return (
    <Panel
      title="两种接入方式"
      description="都要先有凭据，区别只是谁来配客户端。多数情况用自助接入：人只交一段文本。"
    >
      <ol className={styles.paths}>
        <li>
          <strong className={styles.pathTitle}>自助接入（推荐）</strong>
          <p className={styles.pathBody}>
            在下面的名册里点某个 Agent 的「签发接入令牌」，把弹出的接入包整段发给它。
            它自己兑换密钥、拉规范、查可委派目标；你不用替它改任何客户端配置。
            签发不影响正在跑的 Agent，旧密钥在它兑换那一刻才作废。
          </p>
        </li>
        <li>
          <strong className={styles.pathTitle}>手工接入</strong>
          <p className={styles.pathBody}>
            点「轮换密钥」，你会拿到明文密钥，页面给出 Claude Code、通用 MCP、WorkBuddy 三份配置，
            你自己写进客户端。轮换立即作废旧密钥。适合客户端已经就位、不想让 Agent 自己换密钥的场景。
          </p>
        </li>
      </ol>
      <p className={styles.hint}>
        两条路径最终拿到的是同一种凭据：{MCP_ACCESS.authHeader}: {MCP_ACCESS.bearerFormat}。
        协作规范正文在《Agent 手册》页；Agent 自己拉的是规范接口，不是那个网页。
      </p>
    </Panel>
  );
}
