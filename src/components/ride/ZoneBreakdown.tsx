import { ZONE_IDS, ZONE_META } from '../../lib/ride/zones';
import { formatMinutes } from '../../lib/uiCopy';
import type { LoadSummary } from '../../lib/ride/load';

interface ZoneBreakdownProps {
  load: LoadSummary;
}

export function ZoneBreakdown({ load }: ZoneBreakdownProps) {
  const totalMinutes = load.movingSeconds / 60;

  return (
    <div className="zone-breakdown">
      {ZONE_IDS.map((id) => {
        const minutes = load.zoneMinutes[id];
        const share = totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0;
        const fill = share;
        const meta = ZONE_META[id];
        return (
          <div className="zone-breakdown__row" key={id}>
            <span className="zone-breakdown__id">{id}</span>
            <span className="zone-breakdown__name">{meta.name}</span>
            <span className="zone-breakdown__range">{meta.rangeLabel}</span>
            <span className="zone-breakdown__track">
              <span
                className="zone-breakdown__fill"
                style={{ width: `${fill}%`, backgroundColor: meta.color }}
              />
            </span>
            <span className="zone-breakdown__time">{formatMinutes(minutes)}</span>
            <span className="zone-breakdown__share">{share.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}
