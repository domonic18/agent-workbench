import styles from "./setup.module.css";

const STEP_TITLES = ["初始化", "添加执行机", "添加项目", "启用 Bug 工作流", "完成"];

export function StepHeader({ step }: { step: number }) {
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
