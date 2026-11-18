interface GaugeProps {
  readonly kind: 'hp' | 'mp' | 'exp';
  readonly value: number;
  readonly max: number;
  readonly label: string;
  readonly showPercent?: boolean;
}

/** HP / MP / EXP bar with segmented pixel shine. */
export function Gauge({ kind, value, max, label, showPercent }: GaugeProps) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const text = showPercent
    ? `${Math.floor(value).toLocaleString()} / ${Math.floor(max).toLocaleString()} (${(ratio * 100).toFixed(2)}%)`
    : `${Math.floor(value).toLocaleString()} / ${Math.floor(max).toLocaleString()}`;
  return (
    <div
      className={`pw-gauge pw-gauge--${kind}`}
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemax={max}
    >
      <span className="pw-gauge__label">{label}</span>
      <div className="pw-gauge__track">
        <div className="pw-gauge__fill" style={{ width: `${ratio * 100}%` }} />
        <span className="pw-gauge__text">{text}</span>
      </div>
    </div>
  );
}
