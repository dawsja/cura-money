import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useDialogLayer } from './dialog-stack';

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  children: ReactNode;
  onClose: () => void;
  role?: 'dialog' | 'alertdialog';
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-busy'?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  closeDisabled?: boolean;
  variant?: 'centered' | 'bottom-sheet';
  overlayClassName?: string;
  contentClassName?: string;
}

export function Dialog({
  children,
  onClose,
  role = 'dialog',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  'aria-busy': ariaBusy,
  initialFocusRef,
  closeOnBackdrop = true,
  closeDisabled = false,
  variant = 'centered',
  overlayClassName,
  contentClassName,
}: DialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const backdropPointerDownRef = useRef(false);
  const { isTopDialog, isTopLayer, zIndex } = useDialogLayer();
  const requestClose = useEffectEvent(() => {
    if (!closeDisabled) onClose();
  });

  useLayoutEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const target = initialFocusRef?.current
      ?? contentRef.current?.querySelector<HTMLElement>('[autofocus]')
      ?? contentRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ?? contentRef.current;
    target?.focus();
    return () => {
      const restoreTarget = restoreFocusRef.current;
      window.requestAnimationFrame(() => restoreTarget?.isConnected && restoreTarget.focus());
    };
  }, [initialFocusRef]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!isTopLayer) return;
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !isTopDialog) return;

      const focusable = [...(contentRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (focusable.length === 0) {
        event.preventDefault();
        contentRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (!contentRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isTopDialog, isTopLayer]);

  return createPortal(
    <div
      data-dialog-overlay=""
      className={clsx('dialog-overlay', `dialog-overlay--${variant}`, overlayClassName)}
      style={{ zIndex }}
      inert={!isTopDialog}
      aria-hidden={!isTopDialog ? 'true' : undefined}
      onPointerDown={(event) => {
        backdropPointerDownRef.current = event.button === 0
          && event.target === event.currentTarget
          && isTopLayer;
      }}
      onClick={(event) => {
        const completedBackdropClick = event.button === 0
          && event.target === event.currentTarget
          && backdropPointerDownRef.current;
        backdropPointerDownRef.current = false;
        if (completedBackdropClick && closeOnBackdrop && isTopLayer) requestClose();
      }}
    >
      <div
        ref={contentRef}
        role={role}
        aria-modal={isTopDialog ? 'true' : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-busy={ariaBusy}
        tabIndex={-1}
        className={clsx('dialog-content', contentClassName)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
