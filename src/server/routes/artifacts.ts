import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";

/** 可下发的执行面产物:只放 aw-node 二进制与校验和,不做目录浏览 */
export const ARTIFACT_FILES = [
  { file: "aw-node-macos-arm64", label: "Apple 芯片(macOS arm64)" },
  { file: "aw-node-macos-x64", label: "Intel(macOS x64)" },
] as const;

const CHECKSUMS_FILE = "checksums.txt";
const VERSION_FILE = "version.txt";
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "not found" } } as const;

/** 产物目录声明的最新采集器版本;未发布产物时返回 null(不提示升级) */
export function readArtifactVersion(dir: string): string | null {
  const path = join(resolve(dir), VERSION_FILE);
  if (!existsSync(path)) {
    return null;
  }
  const version = readFileSync(path, "utf8").trim();
  return /^\d+(\.\d+){0,3}$/.test(version) ? version : null;
}

export interface ArtifactEntry {
  name: string;
  label: string;
  size: number;
  sha256: string | null;
}

/** 读取产物目录里的 checksums.txt:文件名 → sha256(格式同 shasum 输出) */
function readChecksums(path: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(path)) {
    return map;
  }
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [digest, name] = line.trim().split(/\s+/);
    if (digest !== undefined && name !== undefined && /^[0-9a-f]{64}$/.test(digest)) {
      map.set(name, digest);
    }
  }
  return map;
}

/** 列出本机镜像的执行面产物;目录不存在或无产物时返回空数组 */
export function listArtifacts(dir: string): ArtifactEntry[] {
  const root = resolve(dir);
  const checksums = readChecksums(join(root, CHECKSUMS_FILE));
  const entries: ArtifactEntry[] = [];
  for (const { file, label } of ARTIFACT_FILES) {
    const path = join(root, file);
    if (!existsSync(path)) {
      continue;
    }
    entries.push({
      name: file,
      label,
      size: statSync(path).size,
      sha256: checksums.get(file) ?? null,
    });
  }
  return entries;
}

/**
 * 执行面产物下发(04 §8):目标机装不上(到不了 GitHub)时,直接从控制台取件。
 * 只按白名单文件名取,内容非敏感,匿名可读;缺产物时 404,由安装脚本回退 GitHub Release。
 *
 * 路由无条件注册:产物目录可能在控制台启动之后才被发布,按请求逐次判存在,
 * 否则「先起控制台、后发布产物」会一直 404 到下次重启。
 */
export function registerArtifactRoutes(app: FastifyInstance, dir: string): void {
  const root = resolve(dir);
  app.log.info(
    { path: root },
    existsSync(root)
      ? "执行面产物目录就绪,/artifacts 可取件"
      : "未找到执行面产物目录,/artifacts 取件将回 404(安装脚本回退 GitHub Release)",
  );
  const allowed = new Set<string>([
    ...ARTIFACT_FILES.map((item) => item.file),
    CHECKSUMS_FILE,
    VERSION_FILE,
  ]);
  app.get("/artifacts/:name", (request, reply) => {
    const name = (request.params as { name?: string }).name ?? "";
    if (!allowed.has(name)) {
      return reply.code(404).send(NOT_FOUND);
    }
    const path = join(root, name);
    if (!existsSync(path) || !statSync(path).isFile()) {
      return reply.code(404).send({
        error: { code: "NOT_FOUND", message: "产物不存在,控制台未镜像该平台产物" },
      });
    }
    // 不缓存:二进制与 checksums.txt 必须同版本,缓存会让两者取到不同批次的产物
    return reply
      .header(
        "content-type",
        name === CHECKSUMS_FILE || name === VERSION_FILE
          ? "text/plain; charset=utf-8"
          : "application/octet-stream",
      )
      .header("content-length", statSync(path).size)
      .header("cache-control", "no-cache")
      .send(createReadStream(path));
  });
}
