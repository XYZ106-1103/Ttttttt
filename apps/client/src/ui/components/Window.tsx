import { type ReactNode, useCallback, useRef, useState } from 'react';
import { t } from '../../i18n';

interface WindowProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly width: number;
  readonly initial?: { x: number; y: number };
  readonly onFocus?: () => void;
  readonly zIndex?: number;
  readonly testId?: string;
}

/** Draggable MMO-style window with a title bar and close button. */
export function Window({
  title,
  children,
  onClose,
  width,
  initial,
  onFocus,
  zIndex,
  testId,
}: WindowProps) {
  const [pos, setPos] = useState(
    () => initial ?? { x: Math.max(16, window.innerWidth / 2 - width / 2), y: 120 },
  );
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      onFocus?.();
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onFocus, pos],
  );
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    const x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.current.dx));
    const y = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.current.dy));
    setPos({ x, y });
  }, []);
  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  return (
    <section
      className="pw-window pw-panel pw-panel--ornate"
      style={{ left: pos.x, top: pos.y, width, zIndex }}
      onPointerDown={onFocus}
      data-testid={testId}
      role="dialog"
      aria-label={title}
    >
      <header
        className="pw-window__bar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="pw-window__title">{title}</span>
        <button
          type="button"
          className="pw-window__close"
          onClick={onClose}
          aria-label={t('window.close')}
        >
          ×
        </button>
      </header>
      <div className="pw-window__body">{children}</div>
    </section>
  );
}
