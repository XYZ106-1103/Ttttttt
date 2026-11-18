import type { ReactNode } from 'react';

interface ButtonProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly variant?: 'primary' | 'secondary' | 'ghost';
  readonly disabled?: boolean;
  readonly title?: string;
  readonly active?: boolean;
  readonly className?: string;
  readonly testId?: string;
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
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`pw-btn pw-btn--${variant} ${active ? 'is-active' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
