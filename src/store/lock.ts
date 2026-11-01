import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";

export interface InstanceLock {
  readonly path: string;
  release(): void;
}

interface LockRecord {
  host: string;
  pid: number;
}

const heldLocks = new Set<string>();

function readLock(path: string): LockRecord | null {
  try {
    const [first = "", second] = readFileSync(path, "utf8").trim().split("\n");
    const legacy = second === undefined;
    const pid = Number.parseInt(legacy ? first : second, 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    // 旧格式只有 pid;按本机处理以保持原有的占用判定
    return { host: legacy ? hostname() : first, pid };
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
 * 单实例:O_EXCL 创建 `console.lock` 并写入 `主机名 + pid`。
 * 同主机且 pid 存活才拒绝启动;主机名不同说明是上一次容器实例留下的
 * (pid 命名空间已换,旧 pid 存活与否无意义),直接回收。
 */
export function acquireInstanceLock(path: string): InstanceLock {
  const host = hostname();
  if (heldLocks.has(path)) {
    throw new Error(`已有控制台进程在运行(pid ${process.pid}),锁文件 ${path}`);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, `${host}\n${process.pid}`);
      closeSync(fd);
      heldLocks.add(path);
      return {
        path,
        release(): void {
          heldLocks.delete(path);
          const record = readLock(path);
          if (record?.host === host && record.pid === process.pid) {
            unlinkSync(path);
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const record = readLock(path);
      // 本进程未持有该路径、但锁内 pid 等于自身:是上一次进程(容器内恒为 pid 1)的遗留
      const heldByOther =
        record !== null && record.host === host && record.pid !== process.pid && isAlive(record.pid);
      if (heldByOther) {
        throw new Error(`已有控制台进程在运行(pid ${record.pid}),锁文件 ${path}`, {
          cause: error,
        });
      }
      unlinkSync(path);
    }
  }
  throw new Error(`无法获取实例锁: ${path}`);
}
