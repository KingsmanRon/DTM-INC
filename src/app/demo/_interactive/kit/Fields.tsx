import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx } from "@/app/demo/_interactive/kit/cx";
import { Icon } from "./Icon";

/** Stable DOM id for a field name such as "patient.firstNames". */
export function fieldId(name: string): string {
  return `field-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

interface ShellProps {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  className?: string;
}

/** Stand-alone error line for grouped controls (radio groups, checkboxes). */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span className="field__error" id={id} role="alert">
      <Icon name="alert" />
      {children}
    </span>
  );
}

function Shell({
  name,
  label,
  error,
  hint,
  optional,
  className,
  children,
}: ShellProps & { children: (describedBy: string | undefined) => ReactNode }) {
  const id = fieldId(name);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("field", className)}>
      <label className="field__label" htmlFor={id}>
        {label}
        {optional ? <span className="field__optional"> (optional)</span> : null}
      </label>
      {children(describedBy)}
      {hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field__error" id={errorId} role="alert">
          <Icon name="alert" />
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextField({
  name,
  label,
  error,
  hint,
  optional,
  className,
  ...input
}: ShellProps & Omit<InputHTMLAttributes<HTMLInputElement>, "name" | "id" | "className">) {
  return (
    <Shell {...{ name, label, error, hint, optional, className }}>
      {(describedBy) => (
        <input
          id={fieldId(name)}
          name={name}
          className="input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...input}
        />
      )}
    </Shell>
  );
}

export function SelectField({
  name,
  label,
  error,
  hint,
  optional,
  className,
  children,
  ...select
}: ShellProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, "name" | "id" | "className">) {
  return (
    <Shell {...{ name, label, error, hint, optional, className }}>
      {(describedBy) => (
        <select
          id={fieldId(name)}
          name={name}
          className="select"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...select}
        >
          {children}
        </select>
      )}
    </Shell>
  );
}

export function TextAreaField({
  name,
  label,
  error,
  hint,
  optional,
  className,
  ...area
}: ShellProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "id" | "className">) {
  return (
    <Shell {...{ name, label, error, hint, optional, className }}>
      {(describedBy) => (
        <textarea
          id={fieldId(name)}
          name={name}
          className="textarea"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...area}
        />
      )}
    </Shell>
  );
}
