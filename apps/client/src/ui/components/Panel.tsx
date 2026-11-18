import type { CSSProperties, ReactNode } from 'react';

interface PanelProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly ornate?: boolean;
}

/** The base framed panel of the UI design system (pixel bevel + gold corner studs). */
export function Panel({ children, className = '', style, ornate = true }: PanelProps) {
  return (
    <div className={`pw-panel ${ornate ? 'pw-panel--ornate' : ''} ${className}`} style={style}>
      {children}
    </div>
  );
}
