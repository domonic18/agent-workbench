# 发布与回滚手册（Runbook）

> 部署逻辑唯一入口：`scripts/deploy.sh`。CI 与人工只调它，命令形态完全一致：
> `bash scripts/deploy.sh --tag main-<sha7> --image-repo ccr.ccs.tencentyun.com/<ns>/aw-console`
> （另有只回收镜像的 `bash scripts/deploy.sh --gc-only --image-repo <同上>`，见 §4.1）
> 部署脚本运行在**部署目录**（仓库变量 `DEPLOY_PATH`），不是 git 工作副本。

## 1. 流水线拓扑

```
PR → main     → check + test + migration-guard      （ubuntu-latest，全绿才可合并）
main push     → 同上三查
               → build & push TCR（自托管 runner，main-<sha7> 不可变 tag）
               → deploy（同机自托管：同步资产到 DEPLOY_PATH → deploy.sh）
               → image-gc（if: always()，与部署成败无关，保留最新 3 个 tag）
手动触发      → 同 main push（发布前演练入口）
```

- 单栈一体：没有预发环境，main 上的栈就是生产栈；**合并 PR 即发布动作**，
  不设 Environment 二次审批（PR 合并本身就是人工决策）。
- 镜像 tag = `main-<sha7>`，不可变，不推 `latest`。
- 自托管 job（build / deploy / image-gc）只在 push main 与手动触发上跑，
  **绝不跑 PR**——仓库是 public，PR（含 fork）等于任意代码。
- 迁移不单独成镜像：SQL 内嵌应用镜像（`dist/store/migrations-pg/`），
  应用启动时自跑（forward-only + checksum 锁，02 §7）；`deploy.sh` 的
  `--wait` 健康检查就是迁移闸门——迁移失败 = 新容器起不来 = 自动回滚。
- 生产栈与 runner 同机（macmini）：deploy 不走 SSH，自托管 job 直接执行；
  因此无需 `DEPLOY_SSH_KEY` / `DEPLOY_KNOWN_HOSTS`。

## 2. 首次启用需要准备的东西

| 项 | 位置 | 说明 |
|---|---|---|
| `TCR_USERNAME` / `TCR_PASSWORD` | GitHub Actions secret | TCR 个人版凭据（构建推送用） |
| `TCR_NAMESPACE` | GitHub Actions secret | 镜像命名空间 |
| `DEPLOY_PATH` | GitHub Actions variable | 部署目录（本机绝对路径；不进 YAML、不进文档） |
| 自托管 runner | `~/Workspace/actions-runner/<repo>/` | 名称 `macmini-agent-workbench`，带同名 label；注册与换版见运维手册 |
| TCR 镜像 `aw-console` | TCR 个人版 | 与既有镜像同命名空间 |
| 部署目录骨架 | `DEPLOY_PATH` | `.env`（POSTGRES_PASSWORD 等）、`docker/frpc.toml`（本机 gitignored 配置拷贝）、`workspace/`（从旧栈迁移）；compose 与 deploy.sh 由 CI 每次同步 |

部署目录结构与仓库一致（compose 按 `../.env`、`../workspace` 相对寻址）：

```
<DEPLOY_PATH>/
  .env                  # 本机配置（含 IMAGE=，deploy.sh 写入）；.env.bak* 为轮转备份
  .deploy-state         # deploy.sh 落盘：current/previous tag、时间、status
  .deploy-commit        # CI 写入：本次发布的完整 sha
  scripts/deploy.sh     # CI 每次发布同步
  docker/
    docker-compose.prod.yml   # CI 每次发布同步
    frpc.toml           # 本机配置，不由 CI 下发
  workspace/            # 持久化数据（知识目录、制品、备份），从旧栈迁移
```

## 3. 日常发布

1. 在短期分支（`dev/xxx`）上开发，推运端开 PR；
2. PR 上三查（类型与 lint / 单元测试 / 迁移守卫）全绿后合并到 `main`；
3. 合并触发的 push 即自动走：三查 → 构建推送 TCR → 部署 → 镜像回收；
4. 看 Actions 的 `Deploy / 发布本机生产栈` job 结论；`Verify` 步骤打印
   `.deploy-state` 与容器清单，即发布后现场。

发布前演练：Actions 页手动触发（workflow_dispatch）——跑同样的三查与构建推送，
但 deploy 只在 push 事件上执行，演练不会动生产栈。

## 4. deploy.sh 做了什么（按顺序）

1. **参数校验**：tag 只放行 `^main-[0-9a-f]{7,40}$`；`--image-repo` 只认
   `[a-z0-9./_-]`（防注入、防误传 `latest`）
2. **预检**：docker / compose v2 可用、compose 文件与 `.env` 在位、
   `POSTGRES_PASSWORD` 非空、磁盘余量 ≥ 5G；栈已起但 postgres 不健康 → 硬失败
   （栈未起的首次部署放行）
3. **备份轮转**：`.env` → `.env.bak` → `.env.bak.1` → `.env.bak.2`（最多 3 份），
   并把 `IMAGE` 钉到本次镜像
4. **拉镜像**：拉取失败但本地已有同 tag 镜像时继续（回滚场景下仓库可能不可达）
5. **换容器**：`compose up -d --wait --wait-timeout 180 --no-build --pull never`
   ——迁移随应用启动，健康检查（/healthz）即迁移闸门
6. **核对运行面**：console / frpc / postgres 三服务必须都在 running
7. **落状态**：写 `.deploy-state`（current/previous tag、时间、status=OK）
8. **失败回滚**：任一步失败 → 恢复 `.env` 里的 previous IMAGE → 重新 pull + up +
   复查，状态置 `FAILED_ROLLED_BACK`（回滚本身再失败置 `FAILED_ROLLED_BACK_FAILED`），
   **保留现场**（日志不删）；无论回滚成败，脚本以非零退出让 CI 红
9. **清理**：退出兜底（成功、失败、中途退出都跑）——每仓库保留最新 3 个
   `main-<sha>` tag（当前 + 2 个回滚目标），只 `docker image prune -f`
   （清悬空层，**绝不 `-a`**）。清理报告实际删除的张数与字节数；
   过滤落空（本地无该仓库镜像）一律 **WARN**——空结果不是「无需清理」的证据，
   多半是仓库路径写错；发现 `latest` 标签也只 WARN 不删

### 4.1 只回收镜像（`--gc-only`）

```bash
bash scripts/deploy.sh --gc-only --image-repo ccr.ccs.tencentyun.com/<ns>/aw-console
```

不部署、不碰 `.env`、不碰容器，只按上述规则回收镜像。给 CI 的 `image-gc` job
一个**与部署成败无关**的清理入口；回收失败不判红，看步骤日志与 warning。

## 5. 手动回滚

线上出问题时，先看状态文件：

```bash
cat <DEPLOY_PATH>/.deploy-state
# current_image=...aw-console:main-xxxxxxx
# previous_image=...aw-console:main-yyyyyyy   ← 回滚目标
# status=OK
```

回滚到 previous：

```bash
cd <DEPLOY_PATH>
bash scripts/deploy.sh --tag main-yyyyyyy --image-repo ccr.ccs.tencentyun.com/<ns>/aw-console
```

注意：**回滚不会回滚数据库**。迁移是 forward-only 的，回滚旧镜像后新 schema
会留在库里；新版本的 DDL 必须是旧版本能容忍的（expand-contract：先加列不删列）。

## 6. 排障

| 现象 | 排查 |
|---|---|
| 部署卡在拉镜像 | `docker pull <image>` 手工复现；看是否 TCR 不可达 |
| 健康检查超时（up --wait 超时） | `docker compose -p agent_workbench logs --tail 200 console`——多半是迁移失败，看启动日志里的迁移报错 |
| 迁移报「已应用但内容已变更」 | 迁移只允许新增，禁止改写已发布过的迁移文件；写新迁移补正 |
| 回滚也失败 | 状态 `FAILED_ROLLED_BACK_FAILED`，人工介入；不要清日志 |
| 磁盘告警 | `docker system df`；deploy.sh 已按仓库保留 3 个 tag + `prune -f` |
| 清理报「过滤未命中」 | 仓库路径与本地镜像对不上（`docker images` 按完整仓库名匹配）：核对 `--image-repo` 与 `docker images`，别用短前缀 |

## 7. 本地开发与生产栈的关系

- 生产栈在 `DEPLOY_PATH` 起容器（compose 项目名 `agent-workbench`，
  数据卷 `agent_workbench_postgres` 与旧栈延续）；**本仓的
  `docker/docker-compose.yml` 只作模板保留**，不要用它 `up`——同一项目名会把
  CI 部署的容器换成本地构建的镜像。
- Makefile 的 `up` / `down` / `logs` / `restart` 已改为对部署目录操作，须显式给
  `DEPLOY_PATH`：`make logs DEPLOY_PATH=<部署目录>`；不给会明确报错而不是猜。
- 单元测试连 `127.0.0.1:5433`（生产栈的 postgres），口令从仓库根 `docker/.env`
  读取；测试库是随机建、即用即删的独立库，不碰生产数据。
