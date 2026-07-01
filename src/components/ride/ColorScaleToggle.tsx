import type { ColorScale } from '../../lib/ride/types';

interface ColorScaleToggleProps {
  value: ColorScale;
  onChange: (next: ColorScale) => void;
}

const OPTIONS: Array<{ value: ColorScale; label: string }> = [
  { value: 'speed', label: 'Speed' },
  { value: 'grade', label: 'Grade' },
  { value: 'zone', label: 'Zone' },
  { value: 'aerobar', label: 'Aerobar' },
];

export function ColorScaleToggle({ value, onChange }: ColorScaleToggleProps) {
  return (
    <div className="color-scale">
      <span className="color-scale__label">Color</span>
      <div className="units-toggle">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            className={value === option.value ? 'active' : ''}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
