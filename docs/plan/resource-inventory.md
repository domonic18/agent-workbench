# 线上资源清单

> M1-1 产出。只记录主机、用途、访问入口与运行态事实;**不记录任何密钥内容、口令、指纹**。
> **公开仓库**:本文只保留占位符与结论;真实 IP、域名、主机名与端口见本机 `resource-inventory.local.md`(gitignored)。
> 变更时更新本文件,不含进度状态(进度只写 `development-plan.md`)。

## 1. 主机

| 主机 | IP | 角色 | 访问 | 系统 / 规格 | 现状 |
|------|----|------|------|-------------|------|
| Mac mini(本机) | <lan-ip>(LAN) | Agent 运行机 + 本仓库开发机 | 本机登录;远程入口待确认 | macOS / arm64 | cc-connect 以 launchd 常驻,经飞书接入 Claude Code;Docker 跑 frpc 与本地验证容器 |
| MacBook | <macbook-lan-ip>(LAN,待补) | Agent 运行机(第二台) | 本机登录;远程入口待确认 | macOS / arm64(待确认) | 本期入册;须在 M3-10 前完成 `agent` / `machine` 注册与采集器部署 |
| VM-4-15-ubuntu | <vm-public-ip> | **验收对端**(跨机往返的第二端) | `ssh ubuntu@<vm-public-ip>`,密钥 `<ssh-key>` | Ubuntu 22.04 LTS / kernel 5.15 / 2 vCPU / 2GB RAM / 40GB(6.5G 已用) / 时区 CST | 无 Docker、无 Node、无 pnpm;Python 3.10.12、git 2.34.1;`ubuntu` 用户可免密 sudo |

- 可用密钥:`<ssh-key>`(RSA 4096,实测可登录)。`<ssh-key-2>` 在该机**不被接受**,不要误用。
- 开放端口:22(sshd)、53(仅本机解析器)。无入站 443。
- 2026-10-30 已停用遗留服务:`chatgpt-on-wechat`(`python3 app.py`)停后 `:80` 释放,可用内存 1448MB。重启方式 `cd ~/chatgpt-on-wechat && ./run.sh`。

## 2. 容量判断

2 vCPU / 2GB 内存决定了它的上限:

- **适合**:验收对端(A2A 跨机往返的第二端)、控制台冒烟(只绑 `127.0.0.1`,经 `ssh -L` 隧道访问)、采集器临时测试。
- **不适合**:同时跑 Teleport CE + 多个 Agent 运行时(Teleport auth + proxy 常驻约 300~500MB,叠加 Node 与 SQLite 后余量很小);也**不作为** Agent 运行机的长期载体。

## 3. 穿透与域名

| 项 | 值 |
|----|----|
| frps | `<frps-ip>`;控制口 7000、vhost 80 / 443 均开放;**443 已被 `*.example.com` 通配证书的 HTTPS vhost 占用** |
| frpc | 本机 Docker 容器 `frpc`(`snowdreamtech/frpc`),配置挂载 `~/.frp/frpc.toml`,日志 `~/.frp/logs` |
| 现有代理 | 9 条(域名与端口见本地清单) |
| 本项目待加 | `aw.example.com → 8787`(http,复用 80 vhost)、`aw-teleport`:tcp `remotePort 8443 → 本机 443` |
| DNS | 全部经 CNAME → `gw.example.com` → `<frps-ip>`;`dev` / `aw` / `tp` 均已解析(2026-10-30) |

**已裁决(2026-10-30)**: frps 的 443 被 `*.example.com` 通配证书的 HTTPS vhost 占用,而 Teleport proxy 自带 TLS、需要 TCP 透传,不与 vhost 共用 443。改用独立 tcp `remotePort = 8443`;00 §2、05 §4 与 `docker/frpc.toml.example` 已同步。

**仍未就绪(阻塞 M1-3)**:
1. frps 侧是否放通 8443 未知(其配置不在本仓库),需在加 `aw-teleport` 时用 frpc 日志确认;
2. 两条规则都还没有后端:`8787` 要等 M3 控制台,`443` 要等 M2 Teleport。现加规则只会得到两条死隧道,还要再重启一次 frpc(9 条存量代理瞬断),故推迟到有后端时一并加。

**已知存量问题(非本项目引入)**: 一条存量数据库代理的后端 `host.docker.internal:5433` 连接被拒,隧道本身 `start proxy success`——是目标服务未监听,不是 frp 问题。

## 4. 角色裁决(2026-10-31)

| 主机 | 角色 | 取证件 |
|------|------|--------|
| VM-4-15-ubuntu | **验收对端(A)** | M2.5-7 跨机双机往返:一端跑 Agent、一端作对端,验证消息不经飞书群、停机补投与 `parent_task_id` 上溯 |
| MacBook | **第二台 Agent 运行机** | M3-10 双机验收:两台机各自的采集器与 `collector_id`,会话数据齐全、断点互不干扰 |

- VM 不承担长期 Agent 运行,也不承载 Teleport;只为跨机链路提供对端与冒烟环境。
- MacBook 的 `machine` / `agent` 登记与采集器部署是 M3-10 的开工前提,须在验收前完成。

## 5. 备份落点

| 时间 | 内容 | 位置 | 校验 |
|------|------|------|------|
| 2026-10-30 | 全量提交历史(bundle)+ 工作树(`docs/` 含未提交改动)+ MANIFEST | 本机 `~/Backups/agent-workbench/20261030-102938/`;服务器 `~/backups/agent-workbench/20261030-102938/` | 两端 `sha256 -c` 通过 |

恢复:`git clone repo.bundle agent-workbench && tar xzf worktree.tar.gz -C agent-workbench`。备份不含 `node_modules/ dist/ workspace/ .env`。

## 6. 未登记

- MacBook 已裁决本期入册(§4),但 `machine` / `agent` 记录与采集器尚未落地;在 M3-10 开工前补齐,补齐前它推送的流按未归因处理。
