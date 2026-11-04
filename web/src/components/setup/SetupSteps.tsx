import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client.js";
import {
  bootstrapAdmin,
  completeSetup,
  confirmAgents,
  fetchDiscovery,
  issueEnrollToken,
  runPreflight,
  type BootstrapStatus,
} from "../../api/bootstrap.js";
import { fetchAgents } from "../../api/identity.js";
import styles from "./setup.module.css";

const STEP_TITLES = ["初始化", "添加执行机", "添加项目", "启用 Bug 工作流", "完成"];

function StepHeader({ step }: { step: number }) {
  return (
    <div className={styles.steps} aria-label={`第 ${step} / 4 步`}>
      {STEP_TITLES.slice(0, 4).map((title, index) => {
        const n = index + 1;
        const cls = n < step ? styles.stepDone : n === step ? styles.stepActive : styles.step;
        return <div key={title} className={cls} title={title} />;
      })}
    </div>
  );
}

function Feedback({ error }: { error: string | null }) {
  return error === null ? null : <p className={styles.error}>{error}</p>;
}

export function StepAdmin({ step }: { step: number }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await bootstrapAdmin(token.trim(), password);
      await queryClient.invalidateQueries({ queryKey: ["bootstrap", "status"] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "初始化失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.card}>
      <StepHeader step={step} />
      <h1 className={styles.title}>初始化控制台</h1>
      <p className={styles.description}>
        输入本机启动输出的 bootstrap token 并设置管理员口令,即解锁完整控制台。空库与空知识将自动建好。
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <label className={styles.label} htmlFor="token">bootstrap token</label>
        <input
          id="token"
          className={styles.input}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="从控制台启动日志复制"
          autoComplete="off"
        />
        <label className={styles.label} htmlFor="password">管理员口令</label>
        <input
          id="password"
          className={styles.input}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
        />
        <button className={styles.button} type="submit" disabled={pending || token.trim() === "" || password === ""}>
          {pending ? "初始化中…" : "设置口令并继续"}
        </button>
        <Feedback error={error} />
      </form>
    </div>
  );
}

export function StepMachine({ step, status }: { step: number; status: BootstrapStatus }) {
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const installCommand = token === null ? "" : `curl -fsSL ${origin}/install-aw-node.sh | printf '%s' "${token}" | sh -s -- enroll --url ${origin}`;

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

  const detected = status.machines > 0;
  return (
    <div className={styles.card}>
      <StepHeader step={step} />
      <h1 className={styles.title}>添加执行机</h1>
      <p className={styles.description}>
        在目标机执行安装命令:令牌经 stdin 传入,不进命令行参数与日志。控制台据此换取机器 ID、安装并启动 aw-node。
      </p>
      <button className={styles.button} onClick={() => void issue()} disabled={pending}>
        {pending ? "签发中…" : token === null ? "签发 enroll token" : "重新签发"}
      </button>
      {installCommand !== "" ? (
        <div className={styles.section}>
          <label className={styles.label}>在目标机执行</label>
          <textarea className={styles.textarea} readOnly value={installCommand} />
          {detected ? (
            <p className={styles.hint}>已检测到 {status.machines} 台执行机,可进入下一步。</p>
          ) : (
            <p className={styles.hint}>等待执行机上线并回报心跳…</p>
          )}
        </div>
      ) : null}
      <Feedback error={error} />
    </div>
  );
}

export function StepProjects({ step }: { step: number }) {
  const [selected, setSelected] = useState<Record<string, Record<string, boolean>>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const discovery = useQuery({
    queryKey: ["bootstrap", "discovery"],
    queryFn: fetchDiscovery,
    refetchInterval: 4000,
  });

  const machines = discovery.data?.machines ?? [];
  const picked = useMemo(
    () => machines.flatMap((machine) =>
      machine.projects.filter((project) => selected[machine.machineId]?.[project.name] !== false),
    ),
    [machines, selected],
  );

  function toggle(machineId: string, name: string, value: boolean): void {
    setSelected((prev) => ({
      ...prev,
      [machineId]: { ...(prev[machineId] ?? {}), [name]: value },
    }));
  }

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    const machineId = machines[0]?.machineId;
    if (machineId === undefined) {
      setError("尚未检测到执行机,请先完成上一步");
      setPending(false);
      return;
    }
    try {
      await confirmAgents(
        machineId,
        picked.map((project) =>
          project.cwd === undefined
            ? { project: project.name }
            : { project: project.name, displayName: project.cwd },
        ),
      );
      setConfirmed(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "确认失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.card}>
      <StepHeader step={step} />
      <h1 className={styles.title}>添加项目</h1>
      <p className={styles.description}>
        确认执行机上报的 cc-connect 项目,控制台据此创建主责 Agent 并下发不含明文 Bearer 的运行时配置。
      </p>
      {machines.length === 0 ? (
        <p className={styles.hint}>尚未检测到执行机上报的发现结果…</p>
      ) : (
        machines.map((machine) => (
          <div key={machine.machineId} className={styles.section}>
            <strong>{machine.hostname}</strong>
            {machine.projects.map((project) => (
              <label key={project.name} className={styles.project}>
                <input
                  type="checkbox"
                  checked={selected[machine.machineId]?.[project.name] !== false}
                  onChange={(event) => toggle(machine.machineId, project.name, event.target.checked)}
                />
                <span>
                  {project.name}
                  {project.cwd === undefined ? null : <span className={styles.hint}> · {project.cwd}</span>}
                </span>
              </label>
            ))}
          </div>
        ))
      )}
      <button
        className={styles.button}
        onClick={() => void confirm()}
        disabled={pending || machines.length === 0}
      >
        {pending ? "确认中…" : confirmed ? "已确认,等待配置下发" : "确认项目与主责 Agent"}
      </button>
      {confirmed ? <p className={styles.hint}>aw-node 将自动拉取配置并回执,完成后进入下一步。</p> : null}
      <Feedback error={error} />
    </div>
  );
}

export function StepBugfix({ step, status, onComplete }: { step: number; status: BootstrapStatus; onComplete: () => void }) {
  const [primaryAgentId, setPrimaryAgentId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = useQuery({
    queryKey: ["identity", "agents"],
    queryFn: fetchAgents,
    retry: false,
  });

  const definition = status.definition;
  const activeAgents = (agents.data ?? []).filter((agent) => agent.status === "active");

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (primaryAgentId === "") {
      setError("请选择主责 Agent");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await completeSetup(primaryAgentId);
      onComplete();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "装配失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.card}>
      <StepHeader step={step} />
      <h1 className={styles.title}>启用 Bug 工作流</h1>
      <p className={styles.description}>核对默认 bug_fix 装配摘要,选择主责 Agent 后完成初始化。无需手工编辑 RouteRule 或 Mandate。</p>
      <div className={styles.section}>
        <div><strong>预期结果</strong></div>
        <p className={styles.hint}>{definition.mandate.expectedResult}</p>
        <div><strong>范围</strong></div>
        <p className={styles.hint}>{definition.mandate.scope}</p>
        <div><strong>验收证据</strong></div>
        <ul className={styles.evidence}>
          {definition.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label className={styles.label} htmlFor="primary">主责 Agent</label>
        <select
          id="primary"
          className={styles.input}
          value={primaryAgentId}
          onChange={(event) => setPrimaryAgentId(event.target.value)}
        >
          <option value="">— 选择 —</option>
          {activeAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.displayName} ({agent.project})
            </option>
          ))}
        </select>
        <button className={styles.button} type="submit" disabled={pending}>
          {pending ? "装配中…" : "确认并开始使用"}
        </button>
        <Feedback error={error} />
      </form>
    </div>
  );
}

export function StepDone({ status }: { status: BootstrapStatus }) {
  const preflight = useQuery({
    queryKey: ["bootstrap", "preflight"],
    queryFn: runPreflight,
    retry: false,
  });

  return (
    <div className={styles.card}>
      <h1 className={styles.title}>初始化完成</h1>
      <p className={styles.description}>
        默认 bug_fix 已装配,主责 Agent 已绑定。现在可以去原 Bug 机器人反馈第一个问题,真实 Bug 闭环将在 M3.9 打通。
      </p>
      <ul className={styles.checklist}>
        {preflight.data?.items.map((item) => (
          <li key={item.key} className={styles.checkItem}>
            <span
              className={`${styles.badge} ${
                item.status === "ok" ? styles.ok : item.status === "fail" ? styles.fail : styles.neutral
              }`}
            >
              {item.status === "ok" ? "就绪" : item.status === "fail" ? "失败" : "未配置"}
            </span>
            <span>
              {item.detail}
              {item.hint === undefined ? null : <span className={styles.hint}> — {item.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      {status.assembly === null ? null : (
        <p className={styles.hint}>主责 Agent:{status.assembly.primaryAgentId} · work_kind {status.assembly.workKind}</p>
      )}
    </div>
  );
}
