import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/app/demo/_interactive/kit/cx";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "dark" | "secondary" | "ghost" | "danger" | "on-dark";
export type ButtonSize = "sm" | "md" | "lg";

function classes(variant: ButtonVariant, size: ButtonSize, block?: boolean, extra?: string): string {
  return cx("btn", `btn--${variant}`, size !== "md" && `btn--${size}`, block && "btn--block", extra);
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: IconName;
  iconAfter?: IconName;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  block,
  icon,
  iconAfter,
  className,
  children,
  type = "button",
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={classes(variant, size, block, className)} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} /> : null}
    </button>
  );
}

/** Internal navigation styled as a button. */
export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  block,
  icon,
  iconAfter,
  className,
  children,
  ...rest
}: CommonProps & { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={classes(variant, size, block, className)} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} /> : null}
    </Link>
  );
}

/** External or `mailto:` link styled as a button (plain anchor, no client routing). */
export function AnchorButton({
  href,
  variant = "secondary",
  size = "md",
  block,
  icon,
  iconAfter,
  className,
  children,
  ...rest
}: CommonProps & { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <a href={href} className={classes(variant, size, block, className)} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} /> : null}
    </a>
  );
}
