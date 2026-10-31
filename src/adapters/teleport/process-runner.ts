import { execFile } from "node:child_process";
import type { CommandResult, CommandRunner } from "./tctl.js";

const MAX_BUFFER = 1024 * 1024;

/** 不经过 shell:参数与 stdin 都是结构化传入,避免命令注入 */
export function createProcessRunner(): CommandRunner {
  return {
    run(command, args, input) {
      return new Promise<CommandResult>((resolve, reject) => {
        const child = execFile(
          command,
          args,
          { maxBuffer: MAX_BUFFER },
          (error, stdout, stderr) => {
            if (error === null) {
              resolve({ stdout, stderr });
              return;
            }
            reject(
              new Error(
                `${command} 退出异常: ${error.message}${stderr.trim() === "" ? "" : `; stderr: ${stderr.trim()}`}`,
                { cause: error },
              ),
            );
          },
        );
        child.stdin?.end(input ?? "");
      });
    },
  };
}
