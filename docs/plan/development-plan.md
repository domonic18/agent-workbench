# agent-workbench 迭代计划

> 创建日期: 2026-10-29
> **本文件是状态真相源:里程碑与完成状态只在此维护,不回填过程。**
> 里程碑编号与顺序采用需求原文 §11 方案;分期与里程碑的对应关系见 `docs/requirement/01-requirement.md` §3。

## 里程碑

### M0: 立项与调研(前置)

- 目标: 立项书 + 开源方案调研报告
- 验收标准: 立项书定稿;调研报告覆盖消息网关、知识检索、任务编排、可视化四条线
- 状态: **已完成**。M0-1 立项书 v0.2、M0-2 调研报告 v0.1（四线齐备、含选型结论）、M0-3 需求差异裁决（§6 差异表 + §7 B1~B8）全部落档

### M1: 资源清单 + 通道边界

- 目标: 明确线上资源清单与访问方式,定死 A/B/C 三类通道边界
- 验收标准: 服务器清单与登录方式明确;能力分级可直接落地
- 状态: **进行中,仅余 M1-3**(决策已定、实测待后端)。M1-0 / M1-1 / M1-2 / M1-4 / M1-6 / M1-7 / M1-8 已闭;M1-5 文档口径已闭,**物理就位(容器、tbot 角色、通配证书挂载、目标机 node agent)随公网部署推迟**(用户裁决,本地 Docker 验证已在 M2-2 完成)
- 阻塞项: M1-3 实测需 `aw` / `tp` 后端就绪才能加规则,不阻塞 M1.5 开工;原「资源清单明细(§12-4)」已由 M1-1 关闭;跨机通道已裁决为复用 frp(B1/B7)

### M1.5: 沟通契约(轻量版)

- 目标: 消息模板 + 必填校验 + 任务必填字段
- 验收标准: 缺必填字段的消息被拒收并提示补什么;抽检 20 条可在 10 秒内说清「谁要谁干什么、什么时候要」
- 状态: **已完成**。M1.5-1 / M1.5-2 / M1.5-3 / M1.5-4 / M1.5-5 / M1.5-6 / M1.5-7 全部关闭(SQLite 基线 + 单实例锁 + `/healthz` db 状态、A2A 信封校验、任务域迁移与状态机、飞书长连接入站 + 白名单 + `event_id` 去重、英文斜杠指令解析与回执 + `feishu_command` 审计、24h 回执窗口、20 条样本抽检);验收记录见 [acceptance/M1.5-7.md](acceptance/M1.5-7.md)
- 阻塞项: 无。飞书应用凭据、`open_id` 白名单、机器人所在群与发送权限均已就位;**事件与卡片回调均不启用加密**,`Encrypt Key` 留空;M2-4 起卡片回调改走长连接,不再需要公网回调地址与 `Verification Token`
- 说明: 几乎不需要新基建,但让后续环节都有结构化数据可用

### M2: 能力授权

- 目标: 基于 Teleport CE + tbot 落地 capability 审批与审计;SSH / 数据库经 15 分钟短时证书访问;审批入口先走飞书卡片
- 验收标准: 生产资源零长期凭证;两通道分层验收(proxy 判定 / 权限+hook 拦截),不合并宣称 100%,终端直跑会话单列缺口不计入拦截率;证书 TTL 15 分钟且由 tbot 自动续期;审计可追溯 task_id
- 状态: **进行中**:M2-1 已闭(`0005_capability` 迁移建 capability / capability_audit / tool_call_log,单向状态机含 `issuing` 补偿出口,审计表由触发器强制 append-only);M2-2 已闭(`src/adapters/teleport/` 落地,本地 Docker Teleport CE 18.7.3 实测签发 / 续期 / traits / SSH,记录见 [acceptance/M2-2.md](acceptance/M2-2.md));M2-3 已闭(`/api/capabilities` 申请 / 批准 / 拒绝 / 吊销 + `src/server/jobs/reconcile.ts` 对账作业;批准 saga 经 `issuing` 调 Teleport,失败转 `rejected` 返回 503;最小会话鉴权——登录 / 会话 / CSRF / 幂等键——随本项提前落地);M2-4 已闭(`0007_outbox` 发件箱 + `src/server/jobs/send-worker.ts` 投递 + 长连接 `card.action.trigger` 卡片回调;时间戳窗口 / `open_id` 白名单 / `event_id` 幂等三重校验,审批 actor 记审批人 `open_id`);真实点击已到达服务并触发 saga,本机无 `tctl` / Teleport,签发按设计转 `rejected`(`issue_failed`),`active` 路径待 Teleport 就绪
- 阻塞项: 公网 Teleport 部署(`tp.example.com` + frpc 第二条规则 + 通配证书挂载 + 目标机 node agent)按用户裁决推迟,不阻塞 M2 后续;M2-4 卡片链路已实测(审批群收卡、点击到达服务、白名单/去重通过、审计记审批人 `open_id`);本机容器未装 `tctl`、未起 Teleport,点击按 saga 失败分支落 `rejected` + `issue_failed`,`active` 需等 Teleport 部署;操作步骤见本机 gitignored 的 `docs/plan/feishu-card.local.md`;原「资源清单明细(§12-4)」已由 M1-1 关闭
- 说明: 授权粒度定为「目标 + 动作 + 命令白名单」,解析失败即拒绝;吊销以 TTL 自然过期为主

### M2.5: A2A 通道(传输层)

- 目标: 服务端 + 信箱适配器 + 跨机通道齐备;唤醒机制推迟(WorkBuddy 先按上线补投)
- 验收标准: Agent 间往返脱离飞书群;跨机可达;离线消息不丢且不重复执行
- 状态: 未开始
- 阻塞项: 无(跨机通道已定:复用 frp;WorkBuddy 唤醒暂缓,先按上线补投)
- 说明: 与 M3 配对上线;没有 M3 就停群会让协作直接断掉

### M3: 控制台一期(总览 + 任务)

- 目标: 两类 Agent 同屏可见,只读看板优先;事实源在控制台库;每台机部署采集器
- 验收标准: 首屏 3 秒内答出「谁在跑、跑到哪、用了多少 token」;任一任务能回答「卡在哪一环」;手机可访问;口令登录生效;两台机的会话数据齐全
- 状态: **未开始**。库内口令初始化(`console_credential` + scrypt 哈希)与启动种子已预置;登录 / 会话 / CSRF / 幂等已随 M2-3 提前落地,`0006_session` 建会话表,M3-2 只剩 `Host` 白名单经 frp 实测、登录失败锁定与前端登录页
- 阻塞项: 采集器实现、`aw.example.com` 的 DNS 与 frpc 代理、飞书应用凭据与 `open_id` 白名单(B6);两台机(MacBook / macmini)须在 M3-10 验收前完成注册与采集器部署

### M3.5: 控制台二期(授权屏 + 知识屏)

- 目标: 审批台搬进控制台,飞书卡片退为通知与一键跳转;kb 可浏览可重建
- 验收标准: 授权审批在控制台完成;kb 条目可读可改、索引可整库重建
- 状态: 未开始

### M4: 产出量化 + 周报 + 飞书免登

- 目标: R3 指标与 token 用量上限、周报自动生成、飞书网页应用嵌入免登
- 验收标准: 周报自动出且无需人工修数;任一数字可下钻到会话记录;飞书内打开免登录
- 状态: 未开始

## 任务拆分

里程碑只回答「到哪一步」;任务清单回答「每一步做什么、依赖谁、怎么算做完」。**状态仍只在本文件维护**,任务文件不记进度。

| 里程碑 | 任务清单 | 任务数 | 主要产出 |
|--------|----------|--------|----------|
| M0 | [tasks/M0.md](tasks/M0.md) | 3 | 立项书、调研报告、需求差异裁决 |
| M1 | [tasks/M1.md](tasks/M1.md) | 9 | 资源清单、A/B/C 通道边界、技术选型定稿 |
| M1.5 | [tasks/M1.5.md](tasks/M1.5.md) | 7 | 持久化基线、信封校验、飞书入站指令 |
| M2 | [tasks/M2.md](tasks/M2.md) | 7 | 能力模型、Teleport 签发、MCP 闸门与审计 |
| M2.5 | [tasks/M2.5.md](tasks/M2.5.md) | 8 | MCP 工具面、身份域、发件箱状态机、信箱拉取与死信 |
| M3 | [tasks/M3.md](tasks/M3.md) | 11 | token 记账、采集入库、投影与 SSE、总览与任务两屏 |
| M3.5 | [tasks/M3.5.md](tasks/M3.5.md) | 9 | 授权屏与委派矩阵、知识状态机与索引链、知识写入与检索验收 |
| M4 | [tasks/M4.md](tasks/M4.md) | 4 | 用量上限与硬停、下钻、周报、飞书免登 |

依赖顺序按里程碑串行:M1 定稿 → M1.5 建单能力 → M2 授权 → M2.5 传输 → M3 看见 → M3.5 操作 → M4 计量。M2.5 与 M3 需配对上线。

## 技术验证(Spike)

这些不是新功能,是「不实测就定不了方案」的前提。P0 项若实测不成立,对应里程碑的范围要重新裁决,**不得按原方案硬做**;结论写进归属任务的验收记录,本表只维护状态。

| # | 验证项 | 要回答的问题 | 归属任务 | 状态 |
|---|--------|--------------|----------|------|
| S1 | MCP proxy 接管既有 MCP server | stdio 透传 / 多路复用是否可行,还是要逐个重写 | M2-5、M2.5-0 | 已验证(2026-10-31) |
| S2 | `PreToolUse` hook 覆盖面 | 原生工具有哪些拦不到、能否在会话内被关闭 | M2-6 | 已验证(managed-settings 未测) |
| S3 | Teleport 按 Agent 身份签发 | 每个 Agent 独立短时证书与 `aw-task-id` 标签在 CE 版是否成立 | M2-2 | 已验证(2026-10-31) |
| S4 | 会话文件契约稳定性 | `~/.claude` jsonl 的字段(尤其 token 四维)与目录结构是否稳定 | M3-3 | 已验证(单版本) |
| S5 | 归因率与未归因口径 | cc-connect 会话 id 反向归属的命中率、悬空与歧义;未归因流如何界定 | M3-3 | 已验证(2026-10-31,本机即 macmini);跨机留 M3-10 |

**结论(2026-10-31)**

- **S1 成立**:stdio 透传与多路复用可行,既有 server 不需要重写。实测单 upstream 8 个工具 / 20KB schema 经 proxy 后 schema 逐字不变,25 路并发无串扰,策略拒绝返 `isError` 且调用未到达上游。约束有两条:工具名必须加前缀,最终名 `mcp__<server>__<prefix>__<tool>` 即托管权限白名单的硬契约;`tools/list` 在启动时缓存,上游动态变更不生效。HTTP/SSE 型 MCP 不在 stdio 路径内,需另设入口。
- **S2 成立,一处未测**:hook 同时覆盖原生工具与 MCP 工具(都在 `PreToolUse`,携带 `tool_name`/`tool_use_id`/`transcript_path`),exit 2 与 `permissionDecision: deny` 均生效;会话内改写 `.claude/settings*.json` 被 CC 自身拦下,中途关不掉 hook;`--bare` / `--setting-sources` 可在启动期绕过,属已接受的启动命令缺口。未测:managed-settings 路径需 root 写入,本机无免密 sudo。
- **S3 成立**:CE 18.7.3 全 Docker 部署(单容器 auth+proxy、自签 CA、仅 127.0.0.1)即可验证,无需许可;`role.options.cert_extensions`(v8)在 CE 生效并进入 SSH 证书。关键约束:`{{ external.aw_task_id }}` 会插值,`{{ internal.* }}` 原样保留字面量,模板必须用 `external.*`。身份模型 A/B 都有数据:A 每任务一个 bot(精确,单次建 bot+签发约 0.7s,Teleport 对象随任务数增长);B 每 Agent 一个 bot + 每任务一个 trait(无额外对象,证书随 renewal 生效——10s 间隔下改 trait 约 22s 反映到证书,偏差 ≤ 一个 renewal 周期)。证书 TTL 请求 15m 实发 16m(1m 时钟余量),可续期。真实 SSH 经 proxy 成立,登录名仅 `agentwork`,root 被拒;审计 `session.start` 的 `user_traits` 带 `aw_task_id`,归因按 traits/user,不依赖证书扩展项。trait 变更与证书续期不同步(审计立即反映新值,证书等下一周期),存在一个 renewal 窗口的不一致——要求证书与任务强一致时用每任务身份。tbot 在本机保存的身份材料是长期机器秘密,按密钥管理;`--oneshot` 不留持久状态。运维注意:同名节点重注册会残留重复 host 记录,tsh 按名寻址报二义,节点名需唯一;distroless 镜像无 shell。复现脚本在 `docker/spike/run.sh`(`up|ssh|report|down`)。口径已回写 05 §3/§4/§7/§9、M2-2/M2-7 与 CLAUDE.md。
- **S4 成立**:74 个文件 / 26.7 万行 / 0 解析失败;jsonl 只有 token 四维(`input/output/cache_read/cache_creation`),**不含金额字段**——一期不做计价,正好只取这四个维度;模型名是网关别名(glm-5.3-flash、deepseek-flash、kimi-for-coding、`<synthetic>`),按原文存、不做归一,`<synthetic>` 不入账;子目录 cwd slug 不等于项目 slug,禁止从目录名反推项目;仅存在一个 CC 版本(2.1.123),跨版本未证;`~/.claude/sessions/<pid>.json` 可作运行中判定;子 Agent 的 tool 调用有 hook,但其 token 未进入 jsonl,token 存在少计风险。
- **S5 成立,本机即 macmini**:按同一口径复测,66 个 cc-connect 会话 id(16 当前 + 50 历史)对 74 条 jsonl 流:38 条可归因(11 命中当前 id + 27 仅命中 past id)、28 个悬空指针、0 条多项目歧义。36 条未归因中 18 条是 `/private/tmp` 的试验会话,真实项目未归因约 18 条 → `unattributed_streams` 必须限定为「已登记 `agent_project` 下、本应接管却匹配不到」,禁止按目录名猜,否则任意 CLI 会话都会污染指标。另:cc-connect `config.toml` 只登记 4 个项目而会话状态有 6 个,「已登记」必须以控制台 `agent_project` 表为准,不能拿 cc-connect 配置当注册表。归因机制与机器无关,跨机同构性留到 M3-10 两台机验收。

P1 项(飞书长连接与回调穿 frp、SSE 穿 frp、中文 FTS5 与嵌入服务、launchd 用户域、`sqlite-vec` 与备份、长轮询 25s 超时)不单列,已写成对应任务的「开工前实测」。

## 二期后置池

- 拖拽式编排画布
- A 类只读 API 代理（云资源查询 / 监控）：通道契约保留在 05 §1.1 §3，一期无任务；没有真实上游的只读代理不先做
- 任务级 token 上限与超支降级（一期只做按 Agent 的日 token 上限 + 硬停）
- 树形 handoff 可视化（一期为面包屑）

## 状态图例

未开始 → 进行中 → 已完成 / 搁置

## 变更记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-10-29 | 初始化计划,登记 M0~M4 | 项目立项 |
| 2026-10-29 | 里程碑改为 M0 + M1/M1.5/M2/M2.5/M3/M3.5/M4,采用需求原文 §11 编号 | 原 M0~M4 与需求 §11 内容不一致;统一为单一编号体系,M0 保留为前置 |
| 2026-10-29 | 按 B1~B8 决策更新 M2/M2.5/M3 范围;取消黑板投影 | 跨机走 frp、采集器每机部署、授权采用 Teleport、黑板停用 |
| 2026-10-29 | 工程骨架就绪:目录按 00 §5 建立,`make check` / `make build` / `make backup` / 容器健康检查实测通过 | 关闭 07 评审的 P0×4;后续里程碑可以直接在可运行骨架上开工 |
| 2026-10-30 | 新增 `tasks/` 任务拆分(M0~M4 共 55 项),里程碑只留目标与验收 | 里程碑无法直接开工;拆到任务级才能排依赖、判完工。状态仍只在本文件维护 |
| 2026-10-30 | 修正过时阻塞项:M1 去掉已裁决的跨机通道选型;M3 的 `§12-9` 改为实际出处(§8-4 / B6) | 原引用指向不存在的条款 |
| 2026-10-30 | M1-1 关闭:`docs/plan/resource-inventory.md` 落档(主机 / 容量 / frp 与 DNS / 备份落点) | 资源清单是 M1-2 与 M2 部署的前提 |
| 2026-10-30 | M1-3 裁决已定、实测未开:frp 双规则为 `aw→8787`(http) + `tp:8443→443`(tcp),已同步 00/05/CLAUDE.md/frpc 样例与 DNS;**仍未加规则**——后端未就绪,现在加只会得到两条死隧道并再重启一次 frpc | frps 的 443 被通配证书 vhost 占用,Teleport 需 TCP 透传 |
| 2026-10-30 | M1-4 关闭:技术选型全部转「已定」并精确锁版;服务端由 `node:http` 迁到 Fastify 5,新增 `buildApp` 注入式工厂与测试 | 选型不定稿,M1.5 无法建表、M3 无法起前端 |
| 2026-10-30 | M1-4 复核:**运行时保持 Node 22**（与全机其他项目一致，26 虽是 Active LTS 但不单项目追新）；TS 5.9.3 → 6.0.3、Vitest 2 → 5（+根装 vite 8.3.5 作 peer）、`@types/node` 22.20.5；容器改显式 `npm i -g pnpm@9.15.9`（corepack 在 Node 25+ 已移除，显式安装跨版本可用）。镜像实测 `node -v` 22.23.4，`make check` 全绿 | 运行时统一优先于追新：升 26 时全机一起走，避免本机四个项目各跑一个 Node |
| 2026-10-30 | M1-2 / M1-6 关闭:05 新增 §1.1 通道边界(A/B/C 各自写明发起方、经过进程、失败如何拒),01 新增 §3.1 通道↔鉴权对应与 §4.1 Agent 身份签发 | 原 01 写「HMAC + 库里只存哈希」,二者互斥(验证需原始密钥);统一改为 Bearer + 哈希比对,重放由幂等键与 `msg_id` 去重承担。同步修正 04 与 M2.5/M3/M3.5 里残留的 HMAC 口径;改 Bearer 后采集器密钥必须先签发,补 `POST /api/machines` 与轮换接口(原 HMAC 方案密钥直接来自 env,不存在签发动作) |
| 2026-10-30 | M1-7 / M1-8 关闭:01 §5.2 选定 MCP stdio 接入信箱(两工具 `a2a_inbox` / `a2a_ack`),05 §6.4 增补闸门落点候选表并选定 MCP proxy | SSE 下发与「A2A 只拉不推」冲突且需对端开入站端口;cc-connect 前置与 CC hooks 都只覆盖单一 Agent 实现,形不成唯一入口 |
| 2026-10-30 | M1-5 文档闭:05 §4 补齐部署形态、版本钉死、通配证书复用取舍、tbot 最小权限、AGPL-3.0 不链接口径;物理部署并入 M2-2 | M1 无 Teleport 后端与目标机,证书与角色「就位」只能在 M2 实测,不提前宣称 |
| 2026-10-30 | M3「登录失败锁定窗口」待裁决收口为 5 次 / 10 分钟(需求口径),会话寿命保留 12 小时并记为有意收紧 | 原 01 写 5 分钟、需求写 10 分钟,两个值并存;frp 收敛来源 IP 使锁定近似全局锁,故配「成功即清零」 |
| 2026-10-30 | **M0 关闭**:调研报告 v0.1 复核后确认四条线齐备且已回填 00 §4 选型依据,立项书 v0.2 与 B1~B8 裁决同在,三项任务全部落档 | 计划里写「调研报告进行中」是过时状态;M0 不收尾会让 M1 挂在未完成的前置上 |
| 2026-10-30 | M1.5 登记阻塞项:飞书自建应用凭据、`open_id` 白名单、`chat_id`→项目映射;同时修正 M2 里已失效的「资源清单明细(§12-4)」引用 | 资源清单里没有任何飞书条目,M1.5-4 起无法开工;M2 的旧引用已被 M1-1 关闭 |
| 2026-10-30 | 容器部署路径实测通过:`make up` 构建并起服务,`/healthz` 200、非 root(uid 10001)、仅绑 127.0.0.1、卷持久化生效;验证用镜像与临时文件已清理 | 确认骨架在容器形态下可用,后续 M1.5 可继续用 compose 验收 |
| 2026-10-30 | M1.5-1 / M1.5-2 / M1.5-3 关闭:`src/store/` 落地 SQLite 基线(WAL + `foreign_keys=ON` + forward-only 迁移带 checksum 校验)、`workspace/console.lock` 单实例、`/healthz` 增加 `db` 状态且不可写时 503;`0001_task.sql` 建 task / task_event 并附状态机与阶段机;`src/shared/protocol.ts` 信封校验(缺失与非法一次报全)。实测双实例拒绝、重启迁移无操作、SIGTERM 释放锁 | 建单链路的每个后续环节都要落库,先把库与进程基线做实;信封是 M2.5 的输入契约,可先于飞书通道定稿 |
| 2026-10-30 | **暂不升 pnpm**(9.15.9 → 12.16.1):实测 12 能读 v9 锁文件,但引入 `minimumReleaseAge` 供应链策略,会拒装发布未满策略窗口的包(当前锁文件里的 rolldown 1.2.16 / @types/estree 1.0.10 就被拒);且 12 改为按平台下载原生二进制,容器内需额外验证。留作独立事项 | 升 pnpm 牵着策略与镜像构建两条链,不宜与运行时调整混做一锅 |
| 2026-10-30 | A2A 线程与链路定稿:`a2a_thread` 建线程、`round` 改服务端分配、ACK 带 `task_id` 自动连边、`task.parent_task_id` 区分 `a2a`/`continuation`;用量归属有意从简(仅采集器写、一 run 至多一条任务);同步需求 §2.2/§2.4 与 M2.5/M3 验收 | 复核场景 D 时发现 B 身上两条任务之间无边,链在 B 处断;且需求 §2.4 与 §1.2 建单规则矛盾 |
| 2026-10-30 | 计划层冲突收口:新增 M2.5-0(五个 MCP 工具 + `decide()`),M1.5-5 改为「指令解析与回执」并明写不产生任务,M1.5-4 去掉 `chat_id`→项目映射(仅记来源与回复落点);M2.5-2 依赖改 `M1.5-3`。上表 M1.5 阻塞项随之下调为「凭据 + 白名单」两项(原登记的 `chat_id`→项目映射已不需裁决) | Agent 无处建单、无处发信;飞书入站若按原设计建单,与控制面「谁干活谁建单」冲突;`chat_id` 到项目的映射没有稳定来源,强行维护会变成第三份真相 |
| 2026-10-30 | 按「2 台机 / 7 个 Agent / 7 个机器人」的实况补三处:① `04 §8` 上线清单改为按实际 Agent 数逐个注册,密钥进各自运行环境而非 plist;② `00 §2` 边界约定第 7 条写死「控制台只有一个机器人」,不订阅 Agent 自己的 bot;③ 新增 M3.5-8 委派矩阵 + `PUT /api/agents/:id/targets`,M3.5 任务数 7→8 | 清单单数写法会让一台机只注册出 1 个 Agent,其余调用 MCP 全部 401;7 个 Agent 时有向委派边 42 条,`allowed_targets_json` 原先只有「由控制台会话维护」的说法而没有界面,只能手改库 |
| 2026-10-30 | 采集归因定稿并实测:`agent` 增 `feishu_app_id`、`(machine_id, project)` 唯一;`04 §4` 增 `agent_project` 与两档归因(当前或历史 session id 命中即推送,否则不推送);确认对话正本在 `~/.claude`,`~/.cc-connect/sessions` 只是指针与回放副本。M3-3 / M3-4 验收点同步 | 实测 58 个 Claude 会话里 20 个无任何指针、能命中的 38 个中有 27 个只靠 `past_agent_session_ids`、另有 28 个指针悬空;按目录归因会被 `/dir` 打散,采集器是独立进程也读不到 Agent 的环境变量 |
| 2026-10-31 | **架构定稿三平面**:展示面保留 B/S(手机访问 / 飞书 iframe 免登 / 推广零安装三条硬约束),执行面独立为「采集器 + MCP proxy + 配置托管」;原生工具由 Claude Code 权限 + hook 拦截,形成两条通道、两层拦截;**同期撤回沙箱方案**——cc-connect 不提供启动命令覆盖,无法把 Claude Code 放进 `sandbox-exec`;托盘与进程急停不入一期。M2 验收改为分层取证 | 「C/S 是否更容易约束」评估结论:约束不在浏览器,换展示面不增加拦截能力;沙箱方案在实测 cc-connect 1.5.0 无启动命令覆盖后放弃,代价是终端直跑的会话完全不受拦截,缺口记入 06 O6,不假装受控 |
| 2026-10-31 | 新增第六个 MCP 工具 `kb_write`(只写 `candidate`、服务端强制状态、L1 放行 + 审计),关闭需求 §9-12 #1;M3.5 任务数 8→9;新增「技术验证」S1~S5 与各任务「开工前实测」 | 知识写入此前无通道,场景 B/D 的实现文档无处落地;proxy 接管、hook 覆盖、Teleport 身份、会话文件契约、第二台机归因率都是「不实测不能定稿」的前提 |
| 2026-10-31 | P0 技术验证落档:S1(proxy 透传/多路复用)与 S2(hook 覆盖)成立,S4(会话文件契约)成立,三者结论写入上节;S3 因 Teleport CE 未部署受阻,S5 第二台机因 macmini 未登记受阻 | 三项结论都直接改动 M2-5 / M2-6 / M3-3 的实现前提(前缀即白名单契约、hook 同覆盖 MCP 通道、jsonl 只含 token 四维),不先落档会让后续任务按错误假设开工 |
| 2026-10-31 | 需求与架构对表后补三条契约:M3 新增 M3-0(当日为「价表与计价」,任务数 10→11,`cost_event` 拆 cache 两档并增 `model_price`;该项同日被末行改判为 token 记账);关闭 §9-6 计价口径与 §9-9 预算粒度,预算硬停落到 `decide()` 前置(同步 M2-5、M4-1/M4-2);关闭 §9-12 #2/#3/#5/#6(产出物只收 `kb_`/URL、run 按进程 + 空闲 30 分钟切分、一发通过率改为任务一次交付通过率、project 用封闭清单) | 原计划把计价裁决放在 M4-1,而 M3-5 就要显示今日成本,时序倒置;预算若只在事后结算,需求 §2.5-H「到硬顶停止」无法兑现;三条契约缺口不裁,M2.5/M3 的验收点无处落;「一发通过率」原义可用 `rework_count` 测,不随建单通道消失 |
| 2026-10-31 | 范围与安全口径收口:A 类只读 API 代理一期不建,登记入二期后置池(通道契约保留);来源白名单改为只校验 `Host`,`X-Forwarded-For` 仅记审计;同步 00 目录树、02 表与 workspace 路径、05 状态枚举、03 机器登记入口、01 任务详情返回 | A 类在三份文档里有契约却没有任何里程碑任务,属于「设计了但没人做」;frpc 在容器内使 `XFF` 既不可信也拿不到真实来源,原白名单是无效检查;其余为跨文档漂移(缺 `knowledge/`、`origin` 多一个无产出的值、心跳 30s/60s 两种写法、缺少 `issuing`) |
| 2026-10-31 | S3 关闭:Teleport CE 18.7.3 全 Docker 验证成立,结论写入上节;复现脚本入 `docker/spike/` | 原判「本机无镜像即不可验证」被推翻——容器内可跑完整 auth/proxy/node/tbot 链路,127.0.0.1 + 自签 CA 即可,不再阻塞 M2-2;`external.*` 插值与「按 traits 归因」两条直接决定 role 模板与审计口径 |
| 2026-10-31 | S5 关闭:确认本机即 macmini 且 cc-connect 已常驻,复测 38 可归因 / 28 悬空 / 0 歧义;原「第二台机因 macmini 未登记受阻」系记录错误,跨机同构下放至 M3-10 | 归因机制与机器无关,不依赖第二台机即可验收;另发现 cc-connect `config.toml` 仅 4 个项目而会话状态 6 个,「已登记」须以控制台 `agent_project` 表为准 |
| 2026-10-31 | **用户裁决:取消计价,改为 token-only**。M3-0 由「价表与计价」改为「token 记账」(`token_usage` 四维,删 `model_price` / `price_version` / 金额列);M4 由 5 项压到 4 项,原价表维护删除,预算改为 `usage_limit` 按 Agent 日 token 上限 + `decide()` 硬停;总览「今日成本」改「今日 token 消耗」;S4 结论同步。口令改为库内 scrypt 哈希 + `CONSOLE_INIT_PASSWORD` 仅首启种子,已落迁移 `0002_console_credential.sql` 与 `src/server/credential.ts`;飞书 CLI 不算一等 Agent;调试机定验收对端,MacBook 本期入册 | 价表维护与换汇成本高于收益,token 是采集器可直接取得、可幂等记账的量;口令长期只放 env 会让轮换与库内事实源分离;飞书 CLI 无独立执行体;M2.5-7 / M3-10 需要第二台机与验收对端作取证前提 |
| 2026-10-31 | M1.5-4 关闭:飞书长连接入站(`@larksuiteoapi/node-sdk` 1.76.0) + `feishu_event` 去重表(7 天窗口) + 白名单校验与「无权限」回执;24 小时事件窗口外直接丢弃。实测:群内 @ 机器人 1 条消息,`event_id` 落库、`chat_id` 命中、未重复处理;非白名单与重复事件由单测覆盖 | 指令链路要先有入站与去重基线;非白名单消息不入库,避免把无关成员内容留进控制台库 |
| 2026-10-31 | 飞书自建应用创建:`APP_ID` / `APP_SECRET` 写入本地 `.env`(已实测换 token);**事件与卡片回调均不启用加密**,`Encrypt Key` 留空,不做解密;入站事件走长连接,`/api/feishu/callback` 只留卡片回调 | 加密会把验签与解密绑进主链路,而当前只有自有机器人、无第三方写入;不启用后靠来源 token + 时间戳 + `event_id` 去重 + `open_id` 白名单收敛攻击面。卡片回调虽不加密,但来源 token 不可省——回调地址经 frp 对外,body 明文可伪造 |
| 2026-10-31 | M1.5-5 关闭:指令语法定为英文斜杠命令(`/task list`、`/task <id>`、`/approve`、`/reject`、`/resend`),解析与执行分在 `src/domain/command/`,非斜杠与未登记命令回「不支持」,缺参回全部缺失项;新增 `feishu_command` 审计表(0004)记录原文、规范命令名、结果与回执;审批 / 重发校验任务存在后如实回执「尚未接入(M2)」,**不建单**。实测:群内 `/task list` 回「当前没有任务。」、`你好` 回「不支持该指令」,两条分别落审计为 `handled` / `unsupported` | 命令若走自然语言就要猜意图,与「未命中即不支持」冲突;审计与 7 天去重表分离,否则「为什么回不支持」会随去重清理一起消失;审批与重发的数据面在 M2 / M2.5,提前伪造成功回执会让验收失真 |
| 2026-10-31 | M1.5-6 关闭:回执按事件时间选通道——24h 内 `reply` 原消息,超出改用 `chat_id` 新建;决策抽到 `src/adapters/feishu/reply.ts`(`chooseReplyMode`/`createReplyer`),超窗分支由单测覆盖。核对飞书文档后确认 `reply` 接口本身无 24h 限制,该窗口是本项目产品策略(避免引用失效),入站 24h 窗口使其只兜底延迟与边界 | 「回复有效期」原被当成接口约束,核对后是撤回接口的 24h;策略与接口限制要分开写,否则后续会按错误前提调大窗口 |
| 2026-10-31 | **M1.5 关闭**:M1.5-7 抽检 20 条样本(13 收下 / 7 拒收)全部按预期判定,四要素逐条可读,拒收项逐条指向字段且多缺一次报全;记录落 `acceptance/M1.5-7.md` | 信封规则已有单测,但「人能否 10 秒读懂」只能用真实样本验;抽检同时暴露并确认了两个口径:`notify` 免 `deadline`、`round` 由服务端分配(客户端给 0 属非法) |
| 2026-10-31 | M2-1 关闭:`0005_capability` 建 capability / capability_audit / tool_call_log;状态机单向(`pending → issuing → active / rejected`,`active → expired / revoked`),批准不经 `issuing` 一律非法,`issuing` 的补偿出口固定为 `rejected`;审计表用触发器强制 append-only,UPDATE/DELETE 直接 ABORT | 授权链路的核心风险是「审批状态与实际签发脱节」,状态机把不可能路径(直接 pending→active)在校验层堵死;append-only 若只靠「不写 update 函数」约束不了直连 SQL 的作业,用触发器兜底;保留期清理日后需删数据时改为显式迁移,留评审痕迹 |
| 2026-10-31 | M2-2 关闭:`src/adapters/teleport/`(manifest 白名单渲染 / `tctl create --force -f -` / `execFile` 无 shell)落地;本地 Docker Teleport CE 18.7.3 实测:请求 15m 实发 16m、`aw-task-id` 与 `aw-ticket-id` 经 `{{ external.* }}` 正确插值、30s TTL 续期哈希变化、`agentwork` 可登 `root` 被拒;记录落 `acceptance/M2-2.md`。新发现 bot traits 异步同步到 user,同步前签发会写入字面量模板(约 229ms),已回写 05 §7 并要求 M2-3/M2-7 以对账确认「生效」 | 适配器只是「写 traits」,真正的风险在时序:写入成功不等于证书带新身份;若 M2-3 把 `active` 当作写入完成的同义词,会出现「审批已过、证书仍是旧任务」却不报警的空档 |
| 2026-10-31 | M2-4 代码侧关闭:`0007_outbox` 按 01 §6 / 02 §3.4 建全量状态机,本阶段只写 `push` + `notification`;申请落库后经 `cap:{id}:requested` 幂等入队,`src/server/jobs/send-worker.ts` 定时 claim → `im.message.create(interactive)` → `delivered` / 指数退避 `retry_wait` / 超 8 次 `failed`;`POST /api/feishu/callback` 按「时间戳窗口 → 来源 token → `open_id` 白名单 → `event_id` 去重」校验后调既有 `service.approve/reject`,审计 actor 为审批人 `open_id`。真实回调 E2E 待按 `docs/plan/feishu-card.local.md` 实测 | 通知类投递失败只重试、不围栏任务,故 `sending` / `uncertain` 只在 schema 声明、本阶段不产生;回调地址经 frp 对外,body 明文可伪造,`open_id` 也是可填字段,只有 token + 时间窗 + 幂等三层才能证明来自飞书 |
| 2026-10-31 | M2-3 关闭 + M3-2 范围收窄:M2-3 落地 `/api/capabilities` 申请 / 批准 / 拒绝 / 吊销与对账作业;批准 saga 为 `pending→issuing`(写审计)→ 调 Teleport `applyTaskTraits` → 成功 `issuing→active`(`issued_at` / `expires_at`)、失败 `issuing→rejected` 并返回 503;`issuing` 超 60s 与待批超 24h 由定时作业条件更新收敛。**用户裁决:最小会话鉴权随 M2-3 提前落地**——`0006_session` 建会话表、登录 / 登出、`HttpOnly + SameSite=Lax` 12h cookie、非 GET 校验 `X-Requested-With` 与 `Origin`/`Host`、写操作要求 `Idempotency-Key`;M3-2 后续只补 `Host` 白名单经 frp 实测、登录失败锁定与前端登录页。`capability.subject` 仍是 Agent 身份串,`deriveBotName()` 以确定性规则映射为 Teleport bot 名,登记表映射留 M2.5 | 写接口没有会话就无法安全开放,而 M3-2 排在 M3 内会让 M2-3 长时间挂空;把鉴权拆成「最小可安全开放」与「生产加固」两段,前者随依赖提前,M3-2 只保留需真实流量与前端才能验的部分。幂等键目前是进程内 `Map`,落库随 M3-2 补,重放只保证单进程内一致 |
| 2026-10-31 | **M2-4 传输修订(用户裁决):卡片回调改走飞书长连接**,与消息事件共用一条应用凭据认证的 WebSocket,订阅 `card.action.trigger`;删除 `/api/feishu/callback` 路由与 Verification Token 校验,保留时间窗 / `open_id` 白名单 / `event_id` 幂等;`startFeishuInbound` 注入授权服务,点击后直接调 `service.approve/reject`。已实测审批卡片成功投递到审批群(`outbox` 落 `delivered`),真实点击待飞书后台切换订阅方式并发布版本 | 原 HTTP + token 方案要求公网回调地址与 token 维护,且与消息入站的长连接重复;用户明确选择长连接后,安全边界由应用凭据认证承担,token 不再必要 |
| 2026-10-31 | **M2-4 真实点击实测**:群内点击审批卡片后,卡片事件经长连接到达,时间窗 / 白名单 / `event_id` 幂等全部通过并调用 `service.approve(capabilityId, 审批人 open_id)`;因容器内无 `tctl`、未起 Teleport,签发失败,按 saga 落 `rejected` 并记 `approved` + `issue_failed` 两条审计(actor 为审批人 `open_id`)。同路径用编译产物在容器内复演确认落库;`active` 需 Teleport 就绪后复验 | 卡片链路与授权状态机的接缝(true 传输 → 服务 → 落库)是最容易「看起来通了其实没接上」的地方;执行环境缺少签发上游时,正确结果是失败分支而非跳过,这也顺带验证了补偿出口 |
| 2026-10-31 | M2-4 交互补强:卡片回调同步返回 `{ toast, card }`,点击后即时反馈并把卡片就地替换为终态(去按钮,展示结果 / 审批人 / 到期时间);失败分支按实际结果提示「签发失败」,不做假成功;非白名单 / 非法载荷 / 超窗只弹 `toast`。`handleCardCallback` 返回值由字符串改为结构化结果(带裁决后快照与错误码),`ensureOk` 抽到独立模块避免 `client` ↔ `card` 循环依赖;单测覆盖各分支的 toast 与卡片模板 | 飞书回调只有返回响应体才会改变界面,`return undefined` 等于点完没反应;若一律回「已批准」,签发失败的授权会被 UI 谎报为成功 |
