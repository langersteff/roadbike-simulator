import type { Chunk, ChunkOverrides, RiderProfile } from '../../lib/ride/types';
import type { Position } from '../../types';
import { POSITION_LABELS, SURFACE_LABELS } from '../../lib/constants';
import { gradeCategory } from '../../lib/chunking/strategies';
import { positionExplanation } from '../../lib/ride/simulate';
import { setPositionOverride, setPowerOverride } from '../../lib/ride/overrides';
import { formatMinutes } from '../../lib/uiCopy';
import { NumberInputRow, SelectInputRow } from '../InputRow';

const POSITION_OPTIONS = (Object.keys(POSITION_LABELS) as Position[]).map((value) => ({
  value,
  label: POSITION_LABELS[value],
}));

interface ChunkPopupProps {
  chunk: Chunk;
  profile: RiderProfile;
  autoAerobar: boolean;
  onChange: (next: ChunkOverrides) => void;
}

export function ChunkPopup({ chunk, profile, autoAerobar, onChange }: ChunkPopupProps) {
  const overrides = chunk.overrides;
  const powerOverridden = overrides.power !== undefined;
  const positionOverridden = overrides.position !== undefined;
  const showAutoExplanation = autoAerobar && !positionOverridden;

  return (
    <div className="chunk-popup">
      <div className="chunk-popup__title">
        Chunk #{chunk.index + 1}
        <span className="chunk-popup__range">
          {chunk.startKm.toFixed(1)}–{chunk.endKm.toFixed(1)} km
        </span>
      </div>

      <div className="chunk-popup__edit">
        <div className={`override-row${powerOverridden ? ' override-row--active' : ''}`}>
          <NumberInputRow
            label="Power"
            unitSuffix="W"
            value={powerOverridden ? overrides.power! : profile.baselinePower}
            decimals={0}
            highlighted={powerOverridden}
            onChange={(next) => onChange(setPowerOverride(overrides, next))}
          />
          {powerOverridden && (
            <button
              className="override-row__reset"
              onClick={() => onChange(setPowerOverride(overrides, undefined))}
              title="Reset to auto"
            >
              reset
            </button>
          )}
        </div>

        <div className={`override-row${positionOverridden ? ' override-row--active' : ''}`}>
          <SelectInputRow
            label="Position"
            value={chunk.effectivePosition}
            options={POSITION_OPTIONS}
            onChange={(position) => onChange(setPositionOverride(overrides, position))}
          />
          {positionOverridden && (
            <button
              className="override-row__reset"
              onClick={() => onChange(setPositionOverride(overrides, undefined))}
              title="Reset to auto"
            >
              reset
            </button>
          )}
        </div>
      </div>

      {showAutoExplanation && (
        <p className="chunk-popup__note">{positionExplanation(chunk, autoAerobar)}</p>
      )}

      <dl className="chunk-popup__stats">
        <div>
          <dt>Grade</dt>
          <dd>
            {chunk.effectiveGradePct.toFixed(1)}% · {gradeCategory(chunk.effectiveGradePct)}
          </dd>
        </div>
        <div>
          <dt>Wind</dt>
          <dd>
            {chunk.effectiveHeadwindKph >= 0 ? '+' : ''}
            {chunk.effectiveHeadwindKph.toFixed(1)} km/h
          </dd>
        </div>
        <div>
          <dt>Temp</dt>
          <dd>
            {chunk.effectiveTemperatureC.toFixed(0)} °C
          </dd>
        </div>
        <div>
          <dt>Rain</dt>
          <dd>{chunk.effectivePrecipitationMmH.toFixed(1)} mm/h</dd>
        </div>
        <div>
          <dt>Surface</dt>
          <dd>{SURFACE_LABELS[chunk.effectiveSurface]}</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd className="chunk-popup__stat-strong">
            {chunk.effectiveVelocityKph.toFixed(1)} km/h
          </dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatMinutes(chunk.durationMin)}</dd>
        </div>
        <div>
          <dt>ETA</dt>
          <dd>{formatMinutes(chunk.etaFromStartMin)}</dd>
        </div>
      </dl>
    </div>
  );
}
