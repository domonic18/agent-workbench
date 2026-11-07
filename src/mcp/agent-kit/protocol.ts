import { AGENT_REST } from "../../shared/constants.js";

/**
 * A2A 协作规范正文(手写叙事):给 Agent 看的操作口径。
 *
 * 与 docs/arch/01 §5 的关系:这里是 §5 的「怎么用」版本——同一套协议,改成 Agent 能直接照着做的步骤。
 * 工具参数细节不在这里重复,那些由各工具的 description 自解释(模型调 tools/list 就能看到)。
 */

/** 协议正文;不含任何凭据,可安全下发给 Agent */
export const PROTOCOL_GUIDE = `# A2A 协作规范(agent-workbench 控制台)

你通过控制台与其他 Agent 协作。你有两条通道,任选其一:

- **REST 通道**:任何有 HTTP 能力的运行时都能用,直接请求控制台接口,凭据放在 \`authorization\` 头。格式见第十二节。
- **MCP 通道**:可选。控制台把同一批能力做成 MCP 工具,你调工具即可,端点与配置见第十三节。

第零节到第十一节讲**通用纪律**(两条通道完全一样),第十二节给 REST 通道的精确格式,末节是工具速查表。

下文 \`$BASE\` 指控制台的地址(你连上控制台用的那个地址,不带尾斜杠)。协议正文里的路径都是相对的,接在 \`$BASE\` 后面即可。

## 零、接入自检(先做完这三步,再谈协作)

1. **确认你有凭据**:请求头 \`authorization: Bearer <agentId>.<secret>\`。没有凭据就没有委派通道——这时不要声称已经协作完成。
2. **拉规范**:REST 通道 \`GET $BASE${AGENT_REST.guide}\`;MCP 通道调 \`a2a_guide\`。
3. **查可委派目标**:REST 通道 \`GET $BASE${AGENT_REST.peers}\`,返回你的身份与「你能发给谁」(agent id、名字、项目)。**别靠猜 id 或读控制台源码找 id。**

规范正文(本文件)与一份可直接安装的 Claude Code skill 是同一份内容:\`GET $BASE${AGENT_REST.skill}\` 返回 \`SKILL.md\`(YAML frontmatter + 规范正文 + 工具速查表)。运行时支持 skill 就装上它,规范会随会话自动加载,不必每次手动拉取。

### 三条最容易犯的错

- **不要用 IM 代替委派**:把需求发到飞书群、私聊或口头转述都不是委派。控制台只认 A2A 消息——不建任务、不发消息,就没有交接、没有回执、没有收口,出事也无从追责。要把活交出去,必须走第五、六节的步骤。
- **没有凭据就说没接入**:按上面三步自检;拿不到就明确说「尚未接入控制台」,不要反复探索环境、读源码或猜协议。
- **别用对方的白名单判断自己能不能发**:委派白名单属于**发起方**,见第八节。

## 一、身份与可见范围

- 你的身份来自 Bearer 凭据,服务端据此判定归属。你自述的 \`from\` / \`assignee\` / \`agent_id\` 一律被丢弃,填了也白填。
- 你只能:创建与更新**自己名下**的任务;拉到**发给自己的**消息;承接**派给自己**的工作事项;写**自己任务派生**的知识候选。
- 别人给你的东西不会自动变成你的任务。跨 Agent 的交接靠 ACK 时显式带上自己的 \`task_id\` 建立,服务端同事务写下游任务的父任务关系。

## 二、两个角色

- **发起方**:把一件小事委派给另一个 Agent。你只做委派,不替对方干活,不替对方回答,也不推进自己的任务状态。
- **接收方**:接下委派,产出结论,回执给发起方。

同一个 Agent 在不同消息里可以是任意一个角色。

## 三、消息信封

| 字段 | 谁给 | 规则 |
|---|---|---|
| \`task_id\` | 你 | 必须指向**你自己名下已存在**的任务;不存在直接拒收,不会隐式建单 |
| \`to\` | 你 | 收件方 Agent ID;必须在你的委派白名单内(单向) |
| \`intent\` | 你 | \`request\` / \`reply\` / \`notify\` / \`escalate\` 四选一 |
| \`summary\` | 你 | 一句话说清要什么或回什么;非空,禁止空泛描述 |
| \`expect\` | 你 | 你期待对方交付什么;非空 |
| \`deadline\` | 你 | \`request\` / \`reply\` / \`escalate\` 必填(RFC3339);\`notify\` 可免 |
| \`thread_id\` | 你 | 首条消息**不要带**;续同一话题时带回服务端给的 \`thread_id\` |
| \`reply_to\` | 你 | 回执时带上被回复消息的 \`msg_id\`,必须同线程,跨线程引用会被拒 |
| \`refs\` | 你 | 关联的知识条目 id 或链接 |

服务端生成、你给不了的字段:\`msg_id\`、\`round\`、\`from\`。给了也会被覆盖。

## 四、intent 语义与回执纪律

| intent | 含义 | 对方要不要干活 | 你的回执要求 |
|---|---|---|---|
| \`request\` | 请求对方做一件事 | 要 | 建自己的任务,完成后回 \`reply\`(带自己的 task_id) |
| \`escalate\` | 请求升级处理(要人介入或更高权限) | 要 | 同 \`request\` |
| \`reply\` | 回结论 | 不要 | 只 ACK,不再回执 |
| \`notify\` | 知会,不要求回应 | 不要 | 只 ACK,不再回执 |

**最容易踩的一条**:收到 \`reply\` / \`notify\` 时,只 \`a2a_ack\`,**不要** \`task_create\`,**不要**再 \`a2a_send\` 回执。对回执再回执会形成乒乓,系统据此收口。

## 五、接收侧六步

收到委派后按序完成,不要跳步:

1. 调 \`a2a_inbox\` 拉取消息,记下 \`msg_id\` 与 \`thread_id\`。
2. 按 intent 分支:
   - \`request\` / \`escalate\`:先 \`task_create\` 建**你自己名下**的下游任务(标题取消息 summary),再 \`a2a_ack(msg_id, task_id=你的任务)\`。
   - \`reply\` / \`notify\`:只 \`a2a_ack(msg_id)\`,不要建任务,也不要再发回执。
3. 只有 \`request\` / \`escalate\` 才执行消息 summary 里要求的工作,结论写进任务 \`output\`。
4. 只有 \`request\` / \`escalate\` 才 \`a2a_send\` 回执:intent=\`reply\`,thread_id 与收到的消息一致,reply_to=收到的 msg_id,task_id=你自己的任务,summary 写结论,deadline 必填(当前时间加 30 分钟的 RFC3339)。
5. 只有 \`request\` / \`escalate\` 才 \`task_update\` 推进自己名下任务:开工 \`status=running\`,收尾 \`status=done\`。
6. 全部步骤完成后,用一句话概述(消息条数与任务 id),不要长篇复述。

过程与结论只写进回执与任务字段,不要写进最终回复。

## 六、发起侧四步

1. \`task_create\` 建**你自己名下**的任务(标题写清要委派什么),记下 \`task_id\`。
2. \`a2a_send(intent=request, to=目标 Agent, task_id=你刚建的任务, summary=要对方做什么, expect=要对方交付什么, deadline=你预期的完成时间)\`。
3. 到此结束本回合:不执行任务本身,不替对方回答,也不推进自己任务的状态——根任务由系统在对端回执确认后自动收口。
4. 最终回复一句话:已委派任务 <task_id> 给 <目标 Agent>。

## 七、任务状态机

- status: \`pending → running → (blocked | review) → done | cancelled\`
- stage: \`intake → plan → exec → review → deliver → closed\`

两条链路**相互独立**:关单只需 \`status=done\`,stage 可以停在任意阶段,不必走完。不要把 \`review\` 直接跳到 \`closed\`——那是非法跃迁,服务端会报错并告诉你当前合法去向。只传要改的字段,不传的保持原值。

## 八、委派白名单

- 委派白名单属于**发起方**:你的白名单决定「你能发给谁」,跟对方的白名单没关系。
- \`a2a_send\` 的 \`to\` 必须命中**你的**白名单。白名单是单向的:你能发给 B,不代表 B 能发给你——对方想回你,得对方自己把你加进它的白名单。
- 不知道能发给谁:调 \`GET $BASE${AGENT_REST.peers}\`(返回你的身份与可达目标),或看控制台「授权」屏。
- 被拒时错误里会带出「可达目标」列表,照那个列表选收件人,不要瞎猜 ID。

## 九、失败与死信

- 消息**只有 ACK 才算送达**;从信箱拉走不等于投递成功。
- \`deadline\` 过期仍未 ACK:消息出箱标记失败并写入死信,发件方收到「已过期,请重新发起」。原消息不会复活,要重新发起一次。
- 未 ACK 的消息在租约过期后会重新可见(至少一次投递),所以处理前先按 \`msg_id\` 去重,别把同一条干两遍。

## 十、知识沉淀

- \`kb_write\` 产出的条目状态恒为 \`candidate\`,采纳只能由人完成——写完不等于生效。
- 路径是知识目录内的相对路径(如 \`notes/xxx.md\`),不要越界。

## 十一、拿不准时的最短路径

- 不知道规范怎么用:REST 通道 \`GET $BASE${AGENT_REST.guide}\`;MCP 通道调 \`a2a_guide\`。
- 不知道某个工具有哪些参数:MCP 通道调 \`tools/list\` 看本机工具与 schema。
- 不知道自己能给谁发:\`GET $BASE${AGENT_REST.peers}\`。

## 十二、REST 通道:不配 MCP 也能协作

前置条件:每个请求带 \`authorization: Bearer <agentId>.<secret>\`;写操作(POST / PUT / PATCH)还要带 \`Idempotency-Key\` 头(任意唯一字符串,重试同一次操作时复用同一个)。下文 \`$BASE\` 指控制台地址,不带尾斜杠。

### 建任务(发起侧第一步)

\`POST $BASE/api/tasks\`

\`\`\`json
{
  "title": "查清 X 的归属并给出结论",
  "assigner": "<你的 agentId>",
  "project": "<你的项目名>",
  "parentTaskId": null,
  "deadlineAt": null,
  "output": null
}
\`\`\`

- \`assignee\` 由服务端按 Bearer 身份判定,请求体里写了也无效。
- 返回 201 与 \`{ "task": { "id": "..." } }\`,记下 \`id\` 当作后面的 \`task_id\`。

### 发消息(发起侧第二步)

\`POST $BASE${AGENT_REST.a2aMessages}\`

\`\`\`json
{
  "task_id": "<你刚建的任务 id>",
  "to": "<目标 agent id>",
  "intent": "request",
  "summary": "要对方做什么",
  "expect": "要对方交付什么",
  "deadline": "2026-11-08T12:00:00Z"
}
\`\`\`

- 首条消息不要带 \`thread_id\`;续同一话题才带服务端给的 \`thread_id\`,回执再带 \`reply_to\`。
- \`intent\` 为 \`request\` / \`reply\` / \`escalate\` 时 \`deadline\` 必填(RFC3339),\`notify\` 可免。
- 返回 201 与 \`{ "msg_id": "...", "thread_id": "...", "round": 1 }\`。

### 拉收件箱(接收侧第一步)

\`GET $BASE${AGENT_REST.a2aInbox}?wait=25s\`

- \`wait\` 形如 \`25s\` 或 \`250ms\`,最长 30s;加 \`peek=1\` 只看不领(预检用)。
- 返回 \`{ "items": [{ "msg_id", "thread_id", "task_id", "from", "intent", "summary", "expect", "deadline" }], "nextCursor": "..." }\`。
- 拉到不等于送达:处理完必须 ACK。

### 回执(接收侧第二步)

\`POST $BASE${AGENT_REST.a2aInbox}/<msg_id>/ack\`

\`\`\`json
{ "task_id": "<你自己建的任务 id>" }
\`\`\`

- 接了 \`request\` / \`escalate\` 就带上自己新建的任务 id(这一步建立父子任务关系)。
- 对 \`reply\` / \`notify\` 只 ACK,不要带 \`task_id\`,也不要再发回执。

### 推进自己的任务

\`PATCH $BASE/api/tasks/<task_id>\`,body 取 \`{ "status": "running" }\` 或 \`{ "status": "done", "output": "结论" }\`。

### REST 通道不覆盖的能力

知识库(\`kb_write\` / \`kb_search\`)与工作事项(\`work_*\`)只有 MCP 工具入口,没有等价的 REST 写接口;需要时用 MCP 通道。
`;
