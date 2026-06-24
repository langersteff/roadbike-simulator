import { useState } from 'react';
import { ChevronDown, ChevronUp, Scissors, Combine, MapPin } from 'lucide-react';
import type { Chunk, ChunkOverrides, RiderProfile } from '../../lib/ride/types';
import type { Position, Surface, UnitSystem } from '../../types';
import { POSITION_LABELS, SURFACE_LABELS } from '../../lib/constants';
import { gradeCategory, type GradeCategory } from '../../lib/chunking/strategies';
import { positionExplanation } from '../../lib/ride/simulate';
import { InfoTooltip } from '../InfoTooltip';
import { formatMinutes, WIND_SIGN_TOOLTIP } from '../../lib/uiCopy';
import {
  speedDisplay,
  speedToKph,
  temperatureDisplay,
  temperatureToC,
  UNIT_LABELS,
} from '../../lib/units';
import { NumberInputRow, SelectInputRow } from '../InputRow';

const POSITION_OPTIONS = (Object.keys(POSITION_LABELS) as Position[]).map((value) => ({
  value,
  label: POSITION_LABELS[value],
}));

const SURFACE_OPTIONS = (Object.keys(SURFACE_LABELS) as Surface[]).map((value) => ({
  value,
  label: SURFACE_LABELS[value],
}));

interface ChunkRowProps {
  chunk: Chunk;
  profile: RiderProfile;
  units: UnitSystem;
  autoAerobar: boolean;
  curvyActive: boolean;
  highlighted: boolean;
  onHover: (hovering: boolean) => void;
  onChange: (next: ChunkOverrides) => void;
  onSplit: () => void;
  onMergeWithNext: () => void;
  onJumpToMap: () => void;
  canMerge: boolean;
  canSplit: boolean;
}

export function ChunkRow({
  chunk,
  profile,
  units,
  autoAerobar,
  curvyActive,
  highlighted,
  onHover,
  onChange,
  onSplit,
  onMergeWithNext,
  onJumpToMap,
  canMerge,
  canSplit,
}: ChunkRowProps) {
  const [expanded, setExpanded] = useState(false);
  const overrides = chunk.overrides;
  const patch = (delta: Partial<ChunkOverrides>) => onChange({ ...overrides, ...delta });
  const reset = (key: keyof ChunkOverrides) => {
    const next = { ...overrides };
    delete next[key];
    onChange(next);
  };

  return (
    <div
      className={`chunk-row${highlighted ? ' chunk-row--highlighted' : ''}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="chunk-row__summary" onClick={() => setExpanded((value) => !value)}>
        <span className="chunk-row__index">#{chunk.index + 1}</span>
        <span className="chunk-row__range">
          {chunk.startKm.toFixed(1)}–{chunk.endKm.toFixed(1)} km
        </span>
        <span className="chunk-row__cell">
          <span className={`grade-badge grade-badge--${categorySlug(gradeCategory(chunk.effectiveGradePct))}`}>
            {chunk.effectiveGradePct.toFixed(1)}% · {gradeCategory(chunk.effectiveGradePct)}
          </span>
          {chunk.urban && (
            <span className="urban-badge" title="Within range of an OSM-tagged settlement (city, town, village, suburb, neighbourhood, hamlet). Auto-aerobar is disabled here.">
              Urban
            </span>
          )}
          {curvyActive && chunk.curvy && !chunk.urban && (
            <span className="curvy-badge" title="A twisty stretch: cornering caps the speed here and aerobars are not auto-selected.">
              Curvy
            </span>
          )}
          {chunk.effectiveSurface !== 'asphalt' && (
            <span className="surface-badge" title="Road surface detected from OpenStreetMap (or overridden). Rolling resistance is higher here; aerobars are not auto-selected off asphalt.">
              {SURFACE_LABELS[chunk.effectiveSurface]}
            </span>
          )}
        </span>
        <span className="chunk-row__cell">
          {chunk.effectiveHeadwindKph >= 0 ? '+' : ''}
          {chunk.effectiveHeadwindKph.toFixed(1)} km/h
        </span>
        <span className="chunk-row__cell">{chunk.effectiveTemperatureC.toFixed(0)} °C</span>
        <span className="chunk-row__cell">
          {POSITION_LABELS[chunk.effectivePosition]}
          {autoAerobar && (
            <span onClick={(event) => event.stopPropagation()} style={{ marginLeft: 4, display: 'inline-flex' }}>
              <InfoTooltip
                content={positionExplanation(chunk, autoAerobar)}
                label="Why this position was selected"
              />
            </span>
          )}
        </span>
        <span className="chunk-row__cell">{chunk.effectivePower.toFixed(0)} W</span>
        <span className="chunk-row__cell chunk-row__cell--strong">
          {chunk.effectiveVelocityKph.toFixed(1)} km/h
        </span>
        <span className="chunk-row__cell">{formatMinutes(chunk.durationMin)}</span>
        <button
          className="chunk-row__jump"
          title="Jump to this chunk on the map"
          aria-label="Jump to this chunk on the map"
          onClick={(event) => { event.stopPropagation(); onJumpToMap(); }}
        >
          <MapPin width={16} height={16} />
        </button>
        <button className="chunk-row__expand" onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }}>
          {expanded ? <ChevronUp width={16} height={16} /> : <ChevronDown width={16} height={16} />}
        </button>
      </div>

      {expanded && (
        <div className="chunk-row__details">
          <div className="chunk-row__overrides">
            <OverrideRow
              label="Power"
              suffix="W"
              defaultValue={profile.defaultPower}
              overrideValue={overrides.power}
              decimals={0}
              onSet={(next) => patch({ power: next })}
              onReset={() => reset('power')}
            />
            <OverrideRow
              label="Grade"
              suffix="%"
              defaultValue={chunk.avgGradePct}
              overrideValue={overrides.gradePct}
              decimals={1}
              step={0.1}
              onSet={(next) => patch({ gradePct: next })}
              onReset={() => reset('gradePct')}
            />
            <OverrideRow
              label="Head-/Tailwind"
              suffix={UNIT_LABELS.speed(units)}
              defaultValue={speedDisplay(chunk.effectiveHeadwindKph, units)}
              overrideValue={
                overrides.headwindKph !== undefined ? speedDisplay(overrides.headwindKph, units) : undefined
              }
              decimals={1}
              step={0.5}
              tooltip={WIND_SIGN_TOOLTIP}
              onSet={(next) => patch({ headwindKph: speedToKph(next, units) })}
              onReset={() => reset('headwindKph')}
            />
            <OverrideRow
              label="Temperature"
              suffix={UNIT_LABELS.temperature(units)}
              defaultValue={temperatureDisplay(chunk.weather?.tempC ?? 15, units)}
              overrideValue={
                overrides.temperatureC !== undefined
                  ? temperatureDisplay(overrides.temperatureC, units)
                  : undefined
              }
              decimals={0}
              onSet={(next) => patch({ temperatureC: temperatureToC(next, units) })}
              onReset={() => reset('temperatureC')}
            />
            <OverrideRow
              label="Rain"
              suffix="mm/h"
              defaultValue={chunk.weather?.precipitationMmH ?? 0}
              overrideValue={overrides.precipitationMmH}
              decimals={1}
              step={0.5}
              onSet={(next) => patch({ precipitationMmH: next })}
              onReset={() => reset('precipitationMmH')}
            />
            <SelectOverrideRow
              label="Position"
              autoValue={chunk.positionAuto}
              value={overrides.position}
              options={POSITION_OPTIONS}
              onSet={(position) => patch({ position })}
              onReset={() => reset('position')}
            />
            <SelectOverrideRow
              label="Surface"
              autoValue={chunk.surfaceAuto}
              value={overrides.surface}
              options={SURFACE_OPTIONS}
              onSet={(surface) => patch({ surface })}
              onReset={() => reset('surface')}
            />
          </div>
          <div className="chunk-row__actions">
            <button className="btn btn--ghost" onClick={onSplit} disabled={!canSplit}>
              <Scissors width={14} height={14} strokeWidth={2} /> Split in half
            </button>
            <button className="btn btn--ghost" onClick={onMergeWithNext} disabled={!canMerge}>
              <Combine width={14} height={14} strokeWidth={2} /> Merge with next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORY_SLUGS: Record<GradeCategory, string> = {
  Downhill: 'downhill',
  'Light downhill': 'light-downhill',
  Flat: 'flat',
  'Light uphill': 'light-uphill',
  Uphill: 'uphill',
  'Hard uphill': 'hard-uphill',
};

function categorySlug(category: GradeCategory): string {
  return CATEGORY_SLUGS[category];
}

interface OverrideRowProps {
  label: string;
  suffix?: string;
  defaultValue: number;
  overrideValue: number | undefined;
  decimals?: number;
  step?: number;
  tooltip?: string;
  onSet: (next: number) => void;
  onReset: () => void;
}

function OverrideRow({
  label,
  suffix,
  defaultValue,
  overrideValue,
  decimals = 1,
  step,
  tooltip,
  onSet,
  onReset,
}: OverrideRowProps) {
  const isOverridden = overrideValue !== undefined;
  return (
    <div className={`override-row${isOverridden ? ' override-row--active' : ''}`}>
      <NumberInputRow
        label={label}
        unitSuffix={suffix}
        value={isOverridden ? overrideValue : defaultValue}
        decimals={decimals}
        step={step}
        highlighted={isOverridden}
        tooltip={tooltip}
        onChange={onSet}
      />
      {isOverridden && (
        <button className="override-row__reset" onClick={onReset} title="Reset to auto">
          reset
        </button>
      )}
    </div>
  );
}

interface SelectOverrideRowProps<T extends string> {
  label: string;
  autoValue: T;
  value: T | undefined;
  options: ReadonlyArray<{ value: T; label: string }>;
  onSet: (next: T) => void;
  onReset: () => void;
}

function SelectOverrideRow<T extends string>({
  label,
  autoValue,
  value,
  options,
  onSet,
  onReset,
}: SelectOverrideRowProps<T>) {
  const isOverridden = value !== undefined;
  const effectiveValue = (value ?? autoValue) as T;
  const autoLabel = options.find((option) => option.value === autoValue)?.label ?? '';
  return (
    <div className={`override-row${isOverridden ? ' override-row--active' : ''}`}>
      <SelectInputRow label={`${label} (auto: ${autoLabel})`} value={effectiveValue} options={options} onChange={onSet} />
      {isOverridden && (
        <button className="override-row__reset" onClick={onReset} title="Reset to auto">
          reset
        </button>
      )}
    </div>
  );
}
