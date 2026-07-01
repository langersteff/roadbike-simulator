import { ZONE_IDS, ZONE_META } from '../../lib/ride/zones';

export function ZoneLegend() {
  return (
    <div className="zone-legend">
      {ZONE_IDS.map((id) => {
        const meta = ZONE_META[id];
        return (
          <span className="zone-legend__item" key={id}>
            <span className="zone-legend__swatch" style={{ backgroundColor: meta.color }} />
            {id} {meta.name} ({meta.rangeLabel})
          </span>
        );
      })}
    </div>
  );
}
