import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";

export interface InstanceLock {
  readonly path: string;
  release(): void;
}

function readPid(path: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM 说明进程存在但不属于当前用户,同样算占用
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * 单实例:O_EXCL 创建 `console.lock` 并写入 pid。
 * 锁文件存在且 pid 存活即拒绝启动;pid 已死说明上次异常退出,回收陈旧锁。
 */
export function acquireInstanceLock(path: string): InstanceLock {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return {
        path,
        release(): void {
          if (readPid(path) === process.pid) {
            unlinkSync(path);
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const pid = readPid(path);
      if (pid !== null && isAlive(pid)) {
        throw new Error(`已有控制台进程在运行(pid ${pid}),锁文件 ${path}`, { cause: error });
      }
      unlinkSync(path);
    }
  }
  throw new Error(`无法获取实例锁: ${path}`);
}
