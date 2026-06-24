import { useState } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_TUNING, TUNING_KNOBS, type TuningConfig } from '../../lib/tuning';
import { DEFAULT_SPLIT_CONFIG } from '../../lib/chunking/strategies';

interface TuningPopupProps {
  tuning: TuningConfig;
  minSectionKm: number;
  maxSectionKm: number;
  onChange: (tuning: TuningConfig, minSectionKm: number, maxSectionKm: number) => void;
  onClose: () => void;
}

const GROUPS: Array<'Detection' | 'Aerobar gate'> = ['Detection', 'Aerobar gate'];

export function TuningPopup({ tuning, minSectionKm, maxSectionKm, onChange, onClose }: TuningPopupProps) {
  const [draft, setDraft] = useState<TuningConfig>(tuning);
  const [draftMin, setDraftMin] = useState(minSectionKm);
  const [draftMax, setDraftMax] = useState(maxSectionKm);

  const setKnob = (key: keyof TuningConfig, value: number) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onChange(next, draftMin, draftMax);
  };

  const setMin = (value: number) => {
    setDraftMin(value);
    onChange(draft, value, draftMax);
  };

  const setMax = (value: number) => {
    setDraftMax(value);
    onChange(draft, draftMin, value);
  };

  const reset = () => {
    const defaults = { ...DEFAULT_TUNING };
    setDraft(defaults);
    setDraftMin(DEFAULT_SPLIT_CONFIG.minSectionKm);
    setDraftMax(DEFAULT_SPLIT_CONFIG.maxSectionKm);
    onChange(defaults, DEFAULT_SPLIT_CONFIG.minSectionKm, DEFAULT_SPLIT_CONFIG.maxSectionKm);
  };

  return (
    <div className="tuning-panel" role="dialog" aria-label="Tuning">
        <div className="tuning-panel__head">
          <h3>Tuning</h3>
          <button className="tuning-panel__close" onClick={onClose} aria-label="Close">
            <X width={18} height={18} />
          </button>
        </div>

        {GROUPS.map((group) => (
          <div key={group} className="tuning-group">
            <h4 className="tuning-group__title">{group}</h4>
            {TUNING_KNOBS.filter((knob) => knob.group === group).map((knob) => {
              const toDisplay = knob.toDisplay ?? ((value: number) => value);
              const fromDisplay = knob.fromDisplay ?? ((value: number) => value);
              return (
                <KnobRow
                  key={knob.key}
                  label={knob.label}
                  help={knob.help}
                  min={knob.min}
                  max={knob.max}
                  step={knob.step}
                  value={toDisplay(draft[knob.key])}
                  onChange={(value) => setKnob(knob.key, fromDisplay(value))}
                />
              );
            })}
          </div>
        ))}

        <div className="tuning-group">
          <h4 className="tuning-group__title">Sections</h4>
          <KnobRow label="Min section (km)" help="Sections shorter than this are merged away."
            min={0.2} max={5} step={0.1} value={draftMin} onChange={setMin} />
          <KnobRow label="Max section (km)" help="Sections longer than this are split."
            min={5} max={50} step={1} value={draftMax} onChange={setMax} />
        </div>

        <div className="tuning-panel__actions">
          <button className="btn btn--ghost" onClick={reset}>Reset to defaults</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
    </div>
  );
}

interface KnobRowProps {
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

function KnobRow({ label, help, min, max, step, value, onChange }: KnobRowProps) {
  const clamp = (raw: number) => Math.min(max, Math.max(min, raw));
  return (
    <div className="tuning-row">
      <label className="tuning-row__label" title={help}>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        type="number"
        className="tuning-row__num"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isNaN(next)) onChange(clamp(next));
        }}
      />
    </div>
  );
}
