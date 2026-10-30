# 线上资源清单

> M1-1 产出。只记录主机、用途、访问入口与运行态事实;**不记录任何密钥内容、口令、指纹**。
> 变更时更新本文件,不含进度状态(进度只写 `development-plan.md`)。

## 1. 主机

| 主机 | IP | 角色 | 访问 | 系统 / 规格 | 现状 |
|------|----|------|------|-------------|------|
| VM-4-15-ubuntu | <vm-public-ip> | 调试机(待定角色) | `ssh ubuntu@<vm-public-ip>`,密钥 `<ssh-key>` | Ubuntu 22.04 LTS / kernel 5.15 / 2 vCPU / 2GB RAM / 40GB(6.5G 已用) / 时区 CST | 无 Docker、无 Node、无 pnpm;Python 3.10.12、git 2.34.1;`ubuntu` 用户可免密 sudo |

- 可用密钥:`<ssh-key>`(RSA 4096,实测可登录)。`<ssh-key-2>` 在该机**不被接受**,不要误用。
- 开放端口:22(sshd)、53(仅本机解析器)。无入站 443。
- 2026-10-30 已停用遗留服务:`chatgpt-on-wechat`(`python3 app.py`)停后 `:80` 释放,可用内存 1448MB。重启方式 `cd ~/chatgpt-on-wechat && ./run.sh`。

## 2. 容量判断

2 vCPU / 2GB 内存决定了它的上限:

- **适合**:采集器常驻、控制台冒烟(只绑 `127.0.0.1`,经 `ssh -L` 隧道访问)、A2A 跨机往返测试。
- **不适合**:同时跑 Teleport CE + 多个 Agent 运行时(Teleport auth + proxy 常驻约 300~500MB,叠加 Node 与 SQLite 后余量很小)。

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

**已知存量问题(非本项目引入)**: `staging-db-proxy` 的后端 `host.docker.internal:5433` 连接被拒,隧道本身 `start proxy success`——是目标服务未监听,不是 frp 问题。

## 4. 待确认(阻塞本机定角色)

| # | 事项 | 说明 |
|---|------|------|
| 1 | 调试机(<vm-public-ip>)在项目中的角色 | 采集器测试机 / M2.5 第二台机 / 临时用完即弃;影响「跨机可达」验收的取证方式 |

## 5. 备份落点

| 时间 | 内容 | 位置 | 校验 |
|------|------|------|------|
| 2026-10-30 | 全量提交历史(bundle)+ 工作树(`docs/` 含未提交改动)+ MANIFEST | 本机 `~/Backups/agent-workbench/20261030-102938/`;服务器 `~/backups/agent-workbench/20261030-102938/` | 两端 `sha256 -c` 通过 |

恢复:`git clone repo.bundle agent-workbench && tar xzf worktree.tar.gz -C agent-workbench`。备份不含 `node_modules/ dist/ workspace/ .env`。

## 6. 未登记

- 生产/长期运行的主机(如 macmini)尚未提供,登录方式已知为 SSH,明细待补(§12-4)。
