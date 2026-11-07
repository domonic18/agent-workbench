import type { CapabilityTeleportPort, TaskTraits } from "../../domain/capability/ports.js";
import type { TeleportConfig } from "../../config/env.js";
import { renderBotManifest } from "./manifest.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

/** 只经 CLI 与 Teleport 交互(05 §4:不链接其源码,不构成衍生作品) */
export interface CommandRunner {
  run(command: string, args: readonly string[], input?: string): Promise<CommandResult>;
}

/** 兼容旧导出;新代码应使用 domain/capability/ports 的 CapabilityTeleportPort */
export type TeleportAdapter = CapabilityTeleportPort;

export type { TaskTraits };

/**
 * 写入 traits 后不轮询等待:证书要等 tbot 下一次续期(05 §7 已知窗口),
 * 签发结果的确认由 M2-3 的 `issuing` 对账负责,这里只保证指令送达。
 */
export function createTeleportAdapter(
  config: TeleportConfig,
  runner: CommandRunner,
): CapabilityTeleportPort {
  return {
    async applyTaskTraits({ botName, taskId, ticketId }) {
      const manifest = renderBotManifest({
        botName,
        role: config.botRole,
        maxSessionTtl: config.botMaxSessionTtl,
        taskId,
        ticketId,
      });
      const args = [
        ...(config.identityFile === undefined ? [] : [`--identity=${config.identityFile}`]),
        "create",
        "--force",
        "-f",
        "-",
      ];
      try {
        await runner.run(config.tctlPath, args, manifest);
      } catch (error) {
        // 不带出 manifest 内容:traits 会进日志,而日志不记敏感值
        throw new Error(
          `Teleport 写入 bot traits 失败(${botName}): ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    },
  };
}
