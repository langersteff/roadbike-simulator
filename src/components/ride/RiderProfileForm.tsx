import type { UnitSystem } from '../../types';
import { TIRE_LABELS, POSITION_LABELS } from '../../lib/constants';
import {
  UNIT_LABELS,
  weightDisplay,
  weightToKg,
  heightDisplay,
  heightToCm,
} from '../../lib/units';
import { NumberInputRow, SelectInputRow } from '../InputRow';
import type { RiderProfile } from '../../lib/ride/types';
import type { Position, Tire } from '../../types';
import { TIRE_TOOLTIP } from '../../lib/uiCopy';

const TIRE_OPTIONS = (Object.keys(TIRE_LABELS) as Tire[]).map((value) => ({
  value,
  label: TIRE_LABELS[value],
}));

const POSITION_OPTIONS = (Object.keys(POSITION_LABELS) as Position[]).map((value) => ({
  value,
  label: POSITION_LABELS[value],
}));

interface RiderProfileFormProps {
  profile: RiderProfile;
  units: UnitSystem;
  onChange: (next: RiderProfile) => void;
}

export function RiderProfileForm({ profile, units, onChange }: RiderProfileFormProps) {
  const patch = (delta: Partial<RiderProfile>) => onChange({ ...profile, ...delta });

  return (
    <div className="profile-form">
      <NumberInputRow
        label="Rider weight"
        unitSuffix={UNIT_LABELS.weight(units)}
        value={weightDisplay(profile.riderWeight, units)}
        decimals={0}
        onChange={(next) => patch({ riderWeight: weightToKg(next, units) })}
      />
      <NumberInputRow
        label="Bike weight"
        unitSuffix={UNIT_LABELS.weight(units)}
        value={weightDisplay(profile.bikeWeight, units)}
        decimals={0}
        onChange={(next) => patch({ bikeWeight: weightToKg(next, units) })}
      />
      <NumberInputRow
        label="Body height"
        unitSuffix={UNIT_LABELS.height(units)}
        value={heightDisplay(profile.bodyHeightCm, units)}
        decimals={0}
        onChange={(next) => patch({ bodyHeightCm: heightToCm(next, units) })}
      />
      <SelectInputRow
        label="Tire"
        value={profile.tire}
        options={TIRE_OPTIONS}
        tooltip={TIRE_TOOLTIP}
        onChange={(tire) => patch({ tire })}
      />
      <NumberInputRow
        label="Default power"
        unitSuffix="W"
        value={profile.baselinePower}
        decimals={0}
        onChange={(power) => patch({ baselinePower: power })}
      />
      <SelectInputRow
        label="Default position"
        value={profile.defaultPosition}
        options={POSITION_OPTIONS}
        onChange={(position) => patch({ defaultPosition: position })}
      />
    </div>
  );
}
