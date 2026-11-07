/** 执行面产物平台键：与执行面产物的文件名前缀一一对应 */
export type ArtifactKey = "macos-arm64" | "macos-x64";

interface HighEntropyHints {
  architecture?: string;
}

interface UserAgentDataLike {
  getHighEntropyValues?: (hints: string[]) => Promise<HighEntropyHints>;
}

/** 控制台取不到产物时的兜底来源：GitHub Release */
export const GITHUB_RELEASE_BASE = "https://github.com/domonic18/agent-workbench/releases/latest/download";

/** 产物文件名 → 平台键 */
export function artifactKeyOf(name: string): ArtifactKey | null {
  if (name.endsWith("-macos-arm64")) {
    return "macos-arm64";
  }
  if (name.endsWith("-macos-x64")) {
    return "macos-x64";
  }
  return null;
}

/**
 * 识别浏览器所在平台，只用于在下载卡片上标「推荐」。
 * UA 字符串在 Apple 芯片机器上照样报 Intel，能拿到高熵 architecture 才算准；
 * 拿不到就退回 UA 启发。两个平台始终都摆出来让用户自己选，不靠这一项做唯一入口。
 */
export async function detectArtifactKey(): Promise<ArtifactKey | null> {
  if (typeof navigator === "undefined") {
    return null;
  }
  const ua = navigator.userAgent;
  if (!/Macintosh|Mac OS X/i.test(ua)) {
    return null;
  }
  const data = (navigator as Navigator & { userAgentData?: UserAgentDataLike }).userAgentData;
  if (data?.getHighEntropyValues !== undefined) {
    try {
      const hints = await data.getHighEntropyValues(["architecture"]);
      if (hints.architecture === "arm") {
        return "macos-arm64";
      }
      if (hints.architecture === "x86") {
        return "macos-x64";
      }
    } catch {
      // 高熵提示拿不到就退回 UA 启发
    }
  }
  return /Intel/.test(ua) ? "macos-x64" : null;
}
