import styles from "./setup.module.css";

export function Feedback({ error }: { error: string | null }) {
  return error === null ? null : <p className={styles.error}>{error}</p>;
}
