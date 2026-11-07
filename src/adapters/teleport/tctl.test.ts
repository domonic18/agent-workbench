import { describe, expect, it, vi } from "vitest";
import type { TeleportConfig } from "../../config/env.js";
import { createTeleportAdapter, type CommandRunner } from "./tctl.js";

const config: TeleportConfig = {
  tctlPath: "/opt/teleport/tctl",
  identityFile: "/run/teleport/admin-identity",
  botRole: "aw-ext",
  botMaxSessionTtl: "12h",
  auditLogPath: undefined,
};

function runner(): CommandRunner & { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn(async () => ({ stdout: "", stderr: "" })) };
}

describe("createTeleportAdapter", () => {
  it("按 bot 清单写入 traits,identity 走命令行参数", async () => {
    const commands = runner();
    const adapter = createTeleportAdapter(config, commands);

    await adapter.applyTaskTraits({
      botName: "aw-agent-codex",
      taskId: "tsk_1",
      ticketId: "cap_1",
    });

    expect(commands.run).toHaveBeenCalledTimes(1);
    const [command, args, input] = commands.run.mock.calls[0] ?? [];
    expect(command).toBe("/opt/teleport/tctl");
    expect(args).toEqual([
      "--identity=/run/teleport/admin-identity",
      "create",
      "--force",
      "-f",
      "-",
    ]);
    expect(input).toContain('name: aw_task_id');
    expect(input).toContain('values: ["tsk_1"]');
    expect(input).toContain('values: ["cap_1"]');
  });

  it("未配置 identity 时不拼 --identity", async () => {
    const commands = runner();
    const adapter = createTeleportAdapter({ ...config, identityFile: undefined }, commands);

    await adapter.applyTaskTraits({ botName: "aw-agent-codex", taskId: "tsk_1", ticketId: "cap_1" });

    expect(commands.run.mock.calls[0]?.[1]).toEqual(["create", "--force", "-f", "-"]);
  });

  it("tctl 失败向上抛出,消息带 bot 名且不带清单内容", async () => {
    const commands = runner();
    commands.run.mockRejectedValueOnce(new Error("tctl 退出异常: exit code 1"));
    const adapter = createTeleportAdapter(config, commands);

    await expect(
      adapter.applyTaskTraits({ botName: "aw-agent-codex", taskId: "tsk_1", ticketId: "cap_1" }),
    ).rejects.toThrow("Teleport 写入 bot traits 失败(aw-agent-codex): tctl 退出异常: exit code 1");
  });
});
