import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchArtifacts } from "../../api/bootstrap.js";
import { formatBytes } from "../../shared/format.js";
import { Badge } from "../ui/Badge.js";
import { EmptyState } from "../ui/EmptyState.js";
import { Panel } from "../ui/Panel.js";
import { CopyActionButton, CopyBlock } from "./CopyBlock.js";
import { artifactKeyOf, detectArtifactKey, GITHUB_RELEASE_BASE, type ArtifactKey } from "./platform.js";
import styles from "./onboarding.module.css";

export interface DownloadStepProps {
  /** 控制台对外地址，用来拼安装命令与直链 */
  origin: string;
}

/** 平台卡：推荐平台置顶标记，校验和截断显示但可一键复制全量 */
function PlatformCard({
  label,
  size,
  sha256,
  url,
  recommended,
}: {
  label: string;
  size: number;
  sha256: string | null;
  url: string;
  recommended: boolean;
}) {
  const cardClass = recommended
    ? `${styles.platformCard} ${styles.platformRecommended}`
    : styles.platformCard;
  return (
    <div className={cardClass}>
      <div className={styles.platformHead}>
        <span className={styles.platformName}>{label}</span>
        {recommended ? <Badge tone="info" text="推荐" /> : null}
      </div>
      <div className={styles.platformMeta}>
        <span>{formatBytes(size)}</span>
        <span>{sha256 === null ? "控制台未提供校验和" : `SHA-256 ${sha256.slice(0, 16)}…`}</span>
      </div>
      {sha256 === null ? null : (
        <code className={styles.checksum}>{sha256}</code>
      )}
      <div className={styles.platformActions}>
        <a className={styles.downloadLink} href={url} download>
          <Download size={15} aria-hidden="true" />
          下载
        </a>
        <CopyActionButton value={url} label="复制直链" />
        {sha256 === null ? null : (
          <CopyActionButton value={sha256} label="复制校验和" />
        )}
      </div>
    </div>
  );
}

/** 第 1 步：拿产物 —— 平台直链、一键安装命令、校验和与兜底来源 */
export function DownloadStep({ origin }: DownloadStepProps) {
  const [detected, setDetected] = useState<ArtifactKey | null>(null);
  const artifacts = useQuery({ queryKey: ["artifacts"], queryFn: fetchArtifacts });

  useEffect(() => {
    let alive = true;
    void detectArtifactKey().then((key) => {
      if (alive) {
        setDetected(key);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const installCommand = `curl -fsSL ${origin}/artifacts/install.sh | sh -s -- --url ${origin}`;
  const assets = artifacts.data?.assets ?? [];
  const checksumsUrl = `${origin}/artifacts/checksums.txt`;

  return (
    <div className={styles.stack}>
      <Panel
        title="选择平台产物"
        description="aw-node 目前只支持 macOS，按 CPU 架构取对应产物；控制台取不到时安装脚本会自动回退 GitHub Release。"
      >
        {artifacts.isPending ? <p className={styles.hint}>读取产物目录…</p> : null}
        {assets.length === 0 ? (
          <EmptyState
            title="控制台暂未镜像执行面产物"
            description="一键安装命令仍可用：脚本会从 GitHub Release 取件。"
          />
        ) : (
          <div className={styles.platformGrid}>
            {assets.map((asset) => {
              const key = artifactKeyOf(asset.name);
              return (
                <PlatformCard
                  key={asset.name}
                  label={asset.label}
                  size={asset.size}
                  sha256={asset.sha256}
                  url={`${origin}/artifacts/${asset.name}`}
                  recommended={key !== null && key === detected}
                />
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="一键安装" description="在目标机执行下面这条命令，其余步骤脚本会带你走完。">
        <CopyBlock
          label="在目标机执行"
          value={installCommand}
          copyLabel="复制命令"
          copiedText="安装命令已复制"
          note="脚本会自己识别 CPU 架构、下载产物并比对 SHA-256。一次性令牌由脚本交互式隐藏输入，不进命令行参数、不落 shell history。"
        />
        <div className={styles.platformActions}>
          <CopyActionButton value={checksumsUrl} label="复制校验和文件直链" />
          <a
            className={styles.linkSecondary}
            href={`${GITHUB_RELEASE_BASE}/checksums.txt`}
            target="_blank"
            rel="noreferrer"
          >
            GitHub Release 兜底
          </a>
        </div>
      </Panel>
    </div>
  );
}
