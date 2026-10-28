import type { ReactNode } from "react";
import { cx } from "@/app/demo/_interactive/kit/cx";
import { Icon, type IconName } from "./Icon";

export type BadgeTone = "neutral" | "teal" | "navy" | "success" | "warn" | "danger" | "info";

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: BadgeTone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cx("badge", tone !== "neutral" && `badge--${tone}`, className)}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

export function Callout({
  tone = "info",
  icon = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: "info" | "success" | "warn" | "danger" | "teal";
  icon?: IconName;
  title?: string;
  children: ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  return (
    <div className={cx("callout", `callout--${tone}`, className)} role={role}>
      <Icon name={icon} />
      <div>
        {title ? <strong className="callout__title">{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}
