import { useEffect, useState } from "react";
import { ApiError } from "../../api/client.js";
import { fetchArtifacts, issueEnrollToken, type ArtifactView } from "../../api/bootstrap.js";
import { CopyButton } from "./CopyButton.js";
import styles from "./setup.module.css";

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 执行面接入面板:一键安装命令、一次性 enroll token 与分平台直接下载地址。
 * 安装命令与令牌分开展示——令牌不进命令行参数与 shell history,脚本按提示隐藏读取(04 §8)。
 */
export function ExecutionSetupPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<ArtifactView[]>([]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const installCommand = `curl -fsSL ${origin}/artifacts/install.sh | sh -s -- --url ${origin}`;

  // 产物清单匿名可读;面板自取,不依赖上层查询库
  useEffect(() => {
    let alive = true;
    void fetchArtifacts()
      .then((catalog) => {
        if (alive) {
          setAssets(catalog.assets);
        }
      })
      .catch(() => {
        // 取件口不可用时只显示回退提示,不影响安装命令
      });
    return () => {
      alive = false;
    };
  }, []);

  async function issue(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const issued = await issueEnrollToken();
      setToken(issued.token);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "签发失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className={styles.section}>
        <div className={styles.fieldHead}>
          <label className={styles.label} htmlFor="install-command">
            在目标机执行
          </label>
          <CopyButton value={installCommand} label="复制命令" />
        </div>
        <textarea id="install-command" className={styles.textarea} readOnly value={installCommand} />
        <button
          type="button"
          className={styles.buttonGhost}
          onClick={() => void issue()}
          disabled={pending}
        >
          {pending ? "签发中…" : token === null ? "签发 enroll token" : "重新签发"}
        </button>
        {token === null ? null : (
          <>
            <div className={styles.fieldHead}>
              <label className={styles.label} htmlFor="enroll-token">
                enroll token(脚本提示时粘贴,只显示一次)
              </label>
              <CopyButton value={token} label="复制令牌" />
            </div>
            <textarea id="enroll-token" className={styles.textarea} readOnly value={token} />
          </>
        )}
        {error === null ? null : (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      <div className={styles.section}>
        <span className={styles.label}>直接下载 aw-node</span>
        {assets.length === 0 ? (
          <p className={styles.hint}>控制台暂未镜像执行面产物,安装脚本会回退到 GitHub Release 取件。</p>
        ) : (
          <ul className={styles.artifactList}>
            {assets.map((asset) => {
              const url = `${origin}/artifacts/${asset.name}`;
              return (
                <li key={asset.name} className={styles.artifact}>
                  <div className={styles.artifactInfo}>
                    <a className={styles.artifactLink} href={url} download>
                      {asset.label}
                    </a>
                    <span className={styles.hint}>
                      {formatSize(asset.size)}
                      {asset.sha256 === null ? "" : ` · sha256 ${asset.sha256.slice(0, 16)}…`}
                    </span>
                  </div>
                  <CopyButton value={url} label="复制地址" />
                </li>
              );
            })}
          </ul>
        )}
        <p className={styles.hint}>
          手动安装:下载对应产物后执行 <code>aw-node enroll --url {origin}</code>,按提示粘贴 enroll token(输入不回显)。
        </p>
      </div>
    </>
  );
}
