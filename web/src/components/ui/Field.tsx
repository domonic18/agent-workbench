import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import styles from "./controls.module.css";

export interface FieldProps {
  label: ReactNode;
  /** 关联控件的 id，label 会正确指向控件 */
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}

/** 表单字段壳：label + 说明 + 错误，控件本身由调用方传入 */
export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
        {required === true ? <span className={styles.required}>*</span> : null}
      </label>
      {children}
      {error === undefined || error === null ? null : (
        <span className={styles.error} role="alert">
          {error}
        </span>
      )}
      {hint === undefined ? null : <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  const classes = [styles.input, invalid === true ? styles.invalid : null, className]
    .filter((item): item is string => typeof item === "string" && item !== "")
    .join(" ");
  return <input {...rest} className={classes} aria-invalid={invalid === true || undefined} />;
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  const classes = [styles.textarea, invalid === true ? styles.invalid : null, className]
    .filter((item): item is string => typeof item === "string" && item !== "")
    .join(" ");
  return <textarea {...rest} className={classes} aria-invalid={invalid === true || undefined} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  const classes = [styles.select, invalid === true ? styles.invalid : null, className]
    .filter((item): item is string => typeof item === "string" && item !== "")
    .join(" ");
  return (
    <select {...rest} className={classes} aria-invalid={invalid === true || undefined}>
      {children}
    </select>
  );
}
