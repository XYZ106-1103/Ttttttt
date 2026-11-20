import type { ReactNode } from 'react';
import { useContext } from 'react';
import { UiContext } from '../context';

interface ButtonProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  readonly disabled?: boolean;
  readonly title?: string;
  readonly active?: boolean;
  readonly className?: string;
  readonly testId?: string;
  readonly type?: 'button' | 'submit';
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  title,
  active,
  className = '',
  testId,
  type = 'button',
}: ButtonProps) {
  const audio = useContext(UiContext)?.audio;
  return (
    <button
      type={type}
      className={`pw-btn pw-btn--${variant} ${active ? 'is-active' : ''} ${className}`}
      onClick={() => {
        audio?.play('ui_click');
        onClick?.();
      }}
      disabled={disabled}
      title={title}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
