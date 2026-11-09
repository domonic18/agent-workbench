import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * G2/G4 会话活跃探测(M3.10,dispatch-coordination.md §3.1):
 * 判「仍在写入」不取采集扫描态的 last_seen_at——它每轮扫描必刷新,恒为"活跃",
 * 判不出真会话;改按会话文件 mtime 双采样:两轮间 mtime 有前进、或窗口内新出现的
 * 文件才算活跃。刚结束的派发会话只污染一轮,不再挂起 15 分钟。
 */

/** cwd → Claude Code 项目目录名:非字母数字一律替换为 '-',含路径分隔符与前置斜杠 */
export function claudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 单轮采样:projects/<dir>/<uuid>.jsonl → mtime 毫秒;键为 "<dir>/<name>" */
export type SessionSample = ReadonlyMap<string, number>;

export function sampleSessionFiles(claudeDir: string): SessionSample {
  const root = join(claudeDir, "projects");
  const sample = new Map<string, number>();
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return sample;
  }
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const sessionId = name.slice(0, -".jsonl".length);
      if (!UUID.test(sessionId)) {
        continue;
      }
      const path = join(root, dir, name);
      try {
        sample.set(`${dir}/${name}`, statSync(path).mtimeMs);
      } catch {
        // 文件在枚举与 stat 之间被删除:跳过,不影响其余判定
      }
    }
  }
  return sample;
}

/** 单个会话文件是否活跃:有基线比 mtime 前进;无基线(启动首轮)按窗口内新出现兜底 */
function fileActive(prev: SessionSample | undefined, key: string, mtime: number, nowMs: number, windowMs: number): boolean {
  const before = prev?.get(key);
  if (before !== undefined) {
    return mtime > before;
  }
  return nowMs - mtime < windowMs;
}

export interface SessionActivity {
  /** 该 cwd 下是否仍有会话在写入(硬闸门 G2) */
  cwdActive(cwd: string): boolean;
  /** 全机仍在写入的会话文件总数,含交互会话(软闸门 G4) */
  activeCount: number;
}

/** 双采样求活跃判定:prev 为上一轮采样;curr 为本轮 */
export function resolveSessionActivity(
  prev: SessionSample | undefined,
  curr: SessionSample,
  nowMs: number,
  windowMs: number,
): SessionActivity {
  const activeDirs = new Set<string>();
  let activeCount = 0;
  for (const [key, mtime] of curr) {
    if (fileActive(prev, key, mtime, nowMs, windowMs)) {
      activeCount += 1;
      activeDirs.add(key.slice(0, key.indexOf("/")));
    }
  }
  return {
    cwdActive: (cwd: string) => activeDirs.has(claudeProjectDir(cwd)),
    activeCount,
  };
}
