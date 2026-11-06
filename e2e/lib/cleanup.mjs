// 联测脚本自建 Agent 的收尾清理
//
// 联测脚本会注册一次性 Agent(带 runId 后缀的 S10/S41 等)。跑完不删,库里就攒一批
// 垃圾 Agent,总览页与路由注册表都会被它们淹没。这里统一登记本次建出的 Agent,
// 脚本收尾时调 DELETE /api/agents/:id(硬删除 + 级联清理关联行)删干净。
//
// 删除需要控制台会话:调用方传登录后拿到的 cookie。
export function createAgentCleaner({ base, cookie, keyPrefix }) {
  const created = [];
  let done = false;

  return {
    /** 登记一个本次建出的 Agent id,返回同一个 id 便于就地登记 */
    track(id) {
      if (typeof id === "string" && id !== "") {
        created.push(id);
      }
      return id;
    },
    /** 收尾删除;可重复调用,第二次直接返回上次结果 */
    async run() {
      if (done) {
        return [];
      }
      done = true;
      const results = [];
      for (const id of created) {
        const res = await fetch(`${base}/api/agents/${id}`, {
          method: "DELETE",
          headers: {
            cookie,
            "x-requested-with": "fetch",
            "idempotency-key": `${keyPrefix}-${id}`,
          },
        });
        results.push({ id, status: res.status });
      }
      return results;
    },
  };
}

/** 打印清理结果,便于在联测输出里看出删了什么 */
export function reportCleanup(results) {
  if (results.length === 0) {
    console.log("CLEANUP 无需删除");
    return;
  }
  for (const item of results) {
    console.log(
      item.status === 200
        ? `CLEANUP 已删除 ${item.id}`
        : `CLEANUP 删除失败 ${item.id} status=${item.status}`,
    );
  }
}
