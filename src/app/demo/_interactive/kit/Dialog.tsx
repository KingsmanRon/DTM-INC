"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "@/app/demo/_interactive/kit/cx";
import { Icon } from "./Icon";

/**
 * Modal built on the native <dialog> element, which provides focus trapping,
 * Escape-to-close and a backdrop. Children mount only while open.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx("dialog", wide && "dialog--wide")}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? (
        <>
          <div className="dialog__head">
            <h2 id={titleId} className="dialog__title">
              {title}
            </h2>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close dialog">
              <Icon name="x" />
            </button>
          </div>
          <div className="dialog__body">{children}</div>
        </>
      ) : null}
    </dialog>
  );
}
