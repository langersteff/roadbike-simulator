import type { SplitConfig } from '../../lib/chunking/strategies';

interface SplitStrategyPickerProps {
  value: SplitConfig;
  onChange: (next: SplitConfig) => void;
  onApply: () => void;
  busy?: boolean;
}

export function SplitStrategyPicker({ value, onChange, onApply, busy }: SplitStrategyPickerProps) {
  const patch = (delta: Partial<SplitConfig>) => onChange({ ...value, ...delta });

  return (
    <div className="splits">
      <div className="splits__row">
        <label className="splits__check">
          <input
            type="checkbox"
            checked={value.grade}
            onChange={(event) => patch({ grade: event.target.checked })}
          />
          Split by grade
        </label>

        <label className="splits__check">
          <input
            type="checkbox"
            checked={value.fixedDistance.on}
            onChange={(event) =>
              patch({ fixedDistance: { ...value.fixedDistance, on: event.target.checked } })
            }
          />
          Split by distance
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={value.fixedDistance.km}
            disabled={!value.fixedDistance.on}
            onChange={(event) =>
              patch({
                fixedDistance: { ...value.fixedDistance, km: Number(event.target.value) },
              })
            }
          />
          <span className="splits__unit">km</span>
        </label>

        <label
          className="splits__check"
          title="Split off — and never auto-pick aerobar in — sections that pass within range of an OSM-tagged settlement (city / town / village / suburb / neighbourhood / hamlet). Needs internet."
        >
          <input
            type="checkbox"
            checked={value.urbanArea ?? false}
            onChange={(event) => patch({ urbanArea: event.target.checked })}
          />
          Create splits for urban areas
        </label>

        <label
          className="splits__check"
          title="Split off twisty, low-speed stretches from the long straights (computed from the route geometry — no internet needed). Isolated straights become aerobar-friendly sections. Inside an urban area, curviness is absorbed into the urban section."
        >
          <input
            type="checkbox"
            checked={value.curvy ?? false}
            onChange={(event) => patch({ curvy: event.target.checked })}
          />
          Create splits for curvy sections
        </label>

      </div>
        <div className="splits__row">
        <label className="splits__check">
          Min Km per section
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={value.minSectionKm}
            onChange={(event) => patch({ minSectionKm: Number(event.target.value) })}
          />
          <span className="splits__unit">km</span>
        </label>

        <label className="splits__check">
          Max Km per section
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={value.maxSectionKm}
            onChange={(event) => patch({ maxSectionKm: Number(event.target.value) })}
          />
          <span className="splits__unit">km</span>
        </label>

        <button className="btn btn--primary" onClick={onApply} disabled={busy}>
          {busy ? 'Splitting…' : 'Re-split'}
        </button>
        </div>
    </div>
  );
}
