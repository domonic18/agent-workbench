import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SingleInstanceLock {
  release(): void;
}

export class LockHeldError extends Error {
  constructor(readonly pid: number, readonly lockPath: string) {
    super(`另一个 aw-node 实例正在运行(pid ${pid}),锁文件 ${lockPath}`);
    this.name = "LockHeldError";
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface AcquireLockOptions {
  pid?: number;
  /** 进程存活探测,测试注入用 */
  isAlive?: (pid: number) => boolean;
}

/**
 * 每机单 aw-node:锁文件落在 state 目录,持锁进程退出即失锁;
 * 残留锁文件在持有进程死后可被下一实例接管。
 */
export function acquireLock(stateDir: string, options: AcquireLockOptions = {}): SingleInstanceLock {
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? pidAlive;
  const lockPath = join(stateDir, "aw-node.lock");
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });

  if (existsSync(lockPath)) {
    const heldBy = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    if (Number.isInteger(heldBy) && heldBy !== pid && isAlive(heldBy)) {
      throw new LockHeldError(heldBy, lockPath);
    }
    // 持有进程已死:清掉残留锁再竞争
    rmSync(lockPath);
  }
  // O_EXCL 创建:并发双实例只有一个能拿到
  const fd = openSync(lockPath, "wx");
  writeFileSync(fd, String(pid));
  closeSync(fd);

  return {
    release() {
      try {
        if (Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10) === pid) {
          rmSync(lockPath);
        }
      } catch {
        // 锁文件已被清理,视为已释放
      }
    },
  };
}
