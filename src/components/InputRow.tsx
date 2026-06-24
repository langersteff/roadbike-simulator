import { ChangeEvent } from 'react';
import { InfoTooltip } from './InfoTooltip';

interface NumberInputRowProps {
  label: string;
  unitSuffix?: string;
  value: number;
  step?: number;
  decimals?: number;
  highlighted?: boolean;
  tooltip?: string;
  onChange: (next: number) => void;
}

export function NumberInputRow({
  label,
  unitSuffix,
  value,
  step = 1,
  decimals = 0,
  highlighted,
  tooltip,
  onChange,
}: NumberInputRowProps) {
  const handle = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    if (!Number.isNaN(next)) onChange(next);
  };
  return (
    <label className={`input-row${highlighted ? ' input-row--active' : ''}`}>
      <span className="input-row__label">
        {label}
        {tooltip && (
          <span className="input-row__tooltip">
            <InfoTooltip content={tooltip} label={`About ${label}`} />
          </span>
        )}
      </span>
      <span className="input-row__field">
        <input
          type="number"
          step={step}
          value={Number.isFinite(value) ? Number(value.toFixed(decimals)) : 0}
          onChange={handle}
        />
        {unitSuffix && <span className="input-row__suffix">{unitSuffix}</span>}
      </span>
    </label>
  );
}

interface SelectInputRowProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  tooltip?: string;
  onChange: (next: T) => void;
}

export function SelectInputRow<T extends string>({
  label,
  value,
  options,
  tooltip,
  onChange,
}: SelectInputRowProps<T>) {
  return (
    <label className="input-row">
      <span className="input-row__label">
        {label}
        {tooltip && (
          <span className="input-row__tooltip">
            <InfoTooltip content={tooltip} label={`About ${label}`} />
          </span>
        )}
      </span>
      <span className="input-row__field">
        <select value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
