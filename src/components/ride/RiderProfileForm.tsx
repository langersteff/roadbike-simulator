import { TIRE_LABELS, POSITION_LABELS } from '../../lib/constants';
import { NumberInputRow, SelectInputRow } from '../InputRow';
import type { RiderProfile } from '../../lib/ride/types';
import type { Position, Tire } from '../../types';
import { deriveFtpW, RIDE_PROFILES, type RideProfileId } from '../../lib/ride/zones';
import { BASELINE_POWER_TOOLTIP, RIDE_PROFILE_TOOLTIP, TIRE_TOOLTIP } from '../../lib/uiCopy';

const RIDE_PROFILE_OPTIONS = (Object.keys(RIDE_PROFILES) as RideProfileId[]).map((value) => ({
  value,
  label: RIDE_PROFILES[value].label,
}));

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
  rideProfile: RideProfileId;
  onChange: (next: RiderProfile) => void;
  onRideProfileChange: (next: RideProfileId) => void;
}

export function RiderProfileForm({
  profile,
  rideProfile,
  onChange,
  onRideProfileChange,
}: RiderProfileFormProps) {
  const patch = (delta: Partial<RiderProfile>) => onChange({ ...profile, ...delta });

  return (
    <div className="profile-form">
      <NumberInputRow
        label="Rider weight"
        unitSuffix="kg"
        value={profile.riderWeight}
        decimals={0}
        onChange={(next) => patch({ riderWeight: next })}
      />
      <NumberInputRow
        label="Bike weight"
        unitSuffix="kg"
        value={profile.bikeWeight}
        decimals={0}
        onChange={(next) => patch({ bikeWeight: next })}
      />
      <NumberInputRow
        label="Body height"
        unitSuffix="cm"
        value={profile.bodyHeightCm}
        decimals={0}
        onChange={(next) => patch({ bodyHeightCm: next })}
      />
      <SelectInputRow
        label="Tire"
        value={profile.tire}
        options={TIRE_OPTIONS}
        tooltip={TIRE_TOOLTIP}
        onChange={(tire) => patch({ tire })}
      />
      <NumberInputRow
        label="Baseline power"
        unitSuffix="W"
        value={profile.baselinePower}
        decimals={0}
        tooltip={`${BASELINE_POWER_TOOLTIP}\n\nEstimated FTP ≈ ${Math.round(deriveFtpW(profile.baselinePower))} W (baseline treated as mid-Zone-2, 65%).`}
        onChange={(power) => patch({ baselinePower: power })}
      />
      <SelectInputRow
        label="Default position"
        value={profile.defaultPosition}
        options={POSITION_OPTIONS}
        onChange={(position) => patch({ defaultPosition: position })}
      />
      <SelectInputRow
        label="Ride profile"
        value={rideProfile}
        options={RIDE_PROFILE_OPTIONS}
        tooltip={RIDE_PROFILE_TOOLTIP}
        onChange={onRideProfileChange}
      />
    </div>
  );
}
