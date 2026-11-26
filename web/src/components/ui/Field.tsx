import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "../../lib/utils.js";

export interface FieldProps {
  label: ReactNode;
  /** 关联控件的 id，label 会正确指向控件 */
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-text-secondary" htmlFor={htmlFor}>
        {label}
        {required === true ? <span className="ml-1 text-danger">*</span> : null}
      </label>
      {children}
      {error === undefined || error === null ? null : (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      )}
      {hint === undefined ? null : <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

const inputBase =
  "w-full border rounded-md bg-surface text-foreground transition-colors placeholder:text-subtle disabled:bg-surface-3 disabled:text-muted disabled:cursor-not-allowed focus:border-accent focus:ring";

const inputSize = "h-control-md px-3 text-md";

const invalidClasses = "border-danger focus:border-danger focus:ring-ring-danger";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={cn(inputBase, inputSize, invalid === true && invalidClasses, className)}
      aria-invalid={invalid === true || undefined}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      className={cn(
        inputBase,
        "min-h-textarea px-3 py-2 leading-relaxed resize-y",
        invalid === true && invalidClasses,
        className,
      )}
      aria-invalid={invalid === true || undefined}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ invalid, className, children, ...rest }: SelectProps) {
  return (
    <select
      {...rest}
      className={cn(inputBase, inputSize, invalid === true && invalidClasses, className)}
      aria-invalid={invalid === true || undefined}
    >
      {children}
    </select>
  );
}
