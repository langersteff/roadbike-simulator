import { Plus, Trash2 } from 'lucide-react';
import type { BreakAnchor, Chunk, RideBreak } from '../../lib/ride/types';
import { resolveBreaks } from '../../lib/ride/simulate';
import { InfoTooltip } from '../InfoTooltip';
import {
  BREAKS_ADD_LABEL,
  BREAKS_EMPTY,
  BREAKS_HINT,
  BREAKS_TOOLTIP,
  formatClockTime,
  formatMinutes,
} from '../../lib/uiCopy';

interface BreaksPanelProps {
  breaks: RideBreak[];
  chunks: Chunk[];
  startDateTime: string;
  totalKm: number;
  onChange: (next: RideBreak[]) => void;
}

const DEFAULT_DURATION_MIN = 15;

function makeId(): string {
  return crypto.randomUUID();
}

function defaultDistanceAnchor(totalKm: number): BreakAnchor {
  return { kind: 'distance', km: Math.max(0, Math.round(totalKm / 2)) };
}

export function BreaksPanel({ breaks, chunks, startDateTime, totalKm, onChange }: BreaksPanelProps) {
  const resolvedById = new Map(resolveBreaks(chunks, breaks).map((entry) => [entry.id, entry]));

  const addBreak = () => {
    onChange([...breaks, { id: makeId(), anchor: defaultDistanceAnchor(totalKm), durationMin: DEFAULT_DURATION_MIN }]);
  };

  const patchBreak = (id: string, next: Partial<RideBreak>) => {
    onChange(breaks.map((brk) => (brk.id === id ? { ...brk, ...next } : brk)));
  };

  const removeBreak = (id: string) => {
    onChange(breaks.filter((brk) => brk.id !== id));
  };

  const setAnchorKind = (brk: RideBreak, kind: BreakAnchor['kind']) => {
    if (brk.anchor.kind === kind) return;
    const anchor: BreakAnchor = kind === 'distance' ? defaultDistanceAnchor(totalKm) : { kind: 'time', elapsedMin: 60 };
    patchBreak(brk.id, { anchor });
  };

  return (
    <div className="breaks-panel">
      <div className="breaks-panel__header">
        <span className="breaks-panel__hint">
          <InfoTooltip content={BREAKS_TOOLTIP} label="What a break does" />
          {BREAKS_HINT}
        </span>
        <button type="button" className="btn btn--primary breaks-panel__add" onClick={addBreak}>
          <Plus width={16} height={16} />
          {BREAKS_ADD_LABEL}
        </button>
      </div>

      {breaks.length === 0 ? (
        <p className="breaks-panel__empty">{BREAKS_EMPTY}</p>
      ) : (
        <ul className="breaks-panel__list">
          {breaks.map((brk) => {
            const resolved = resolvedById.get(brk.id);
            const beyondRoute = brk.anchor.kind === 'distance' && brk.anchor.km > totalKm;
            const hours = brk.anchor.kind === 'time' ? Math.floor(brk.anchor.elapsedMin / 60) : 0;
            const minutes = brk.anchor.kind === 'time' ? Math.round(brk.anchor.elapsedMin % 60) : 0;
            return (
              <li key={brk.id} className="breaks-panel__row">
                <div className="units-toggle breaks-panel__anchor">
                  <button
                    type="button"
                    className={brk.anchor.kind === 'distance' ? 'active' : ''}
                    onClick={() => setAnchorKind(brk, 'distance')}
                  >
                    At distance
                  </button>
                  <button
                    type="button"
                    className={brk.anchor.kind === 'time' ? 'active' : ''}
                    onClick={() => setAnchorKind(brk, 'time')}
                  >
                    At time
                  </button>
                </div>

                <div className="breaks-panel__fields">
                  {brk.anchor.kind === 'distance' ? (
                    <label className="breaks-panel__field">
                      <input
                        type="number"
                        min={0}
                        max={totalKm || undefined}
                        step={1}
                        value={Number(brk.anchor.km.toFixed(1))}
                        onChange={(event) =>
                          patchBreak(brk.id, { anchor: { kind: 'distance', km: Math.max(0, Number(event.target.value)) } })
                        }
                      />
                      <span className="breaks-panel__unit">km</span>
                    </label>
                  ) : (
                    <label className="breaks-panel__field breaks-panel__field--time">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={hours}
                        onChange={(event) =>
                          patchBreak(brk.id, {
                            anchor: { kind: 'time', elapsedMin: Math.max(0, Number(event.target.value)) * 60 + minutes },
                          })
                        }
                      />
                      <span className="breaks-panel__unit">h</span>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        step={5}
                        value={minutes}
                        onChange={(event) =>
                          patchBreak(brk.id, {
                            anchor: { kind: 'time', elapsedMin: hours * 60 + Math.max(0, Number(event.target.value)) },
                          })
                        }
                      />
                      <span className="breaks-panel__unit">min</span>
                    </label>
                  )}

                  <span className="breaks-panel__for">for</span>

                  <label className="breaks-panel__field">
                    <input
                      type="number"
                      min={5}
                      step={5}
                      value={brk.durationMin}
                      onChange={(event) => patchBreak(brk.id, { durationMin: Math.max(1, Number(event.target.value)) })}
                    />
                    <span className="breaks-panel__unit">min</span>
                  </label>
                </div>

                <span className="breaks-panel__resolved">
                  {beyondRoute
                    ? `Past the route end (${totalKm.toFixed(1)} km) — applied at the finish`
                    : resolved
                      ? `≈ ${resolved.km.toFixed(1)} km · starts ${formatClockTime(startDateTime, resolved.atElapsedMin)} · ${formatMinutes(resolved.durationMin)}`
                      : ''}
                </span>

                <button
                  type="button"
                  className="btn btn--ghost breaks-panel__remove"
                  aria-label="Remove break"
                  onClick={() => removeBreak(brk.id)}
                >
                  <Trash2 width={16} height={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
