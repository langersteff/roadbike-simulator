import { RIDE_PROFILES, type RideProfileId } from '../../lib/ride/zones';
import { InfoTooltip } from '../InfoTooltip';
import { RIDE_PROFILE_TOOLTIP } from '../../lib/uiCopy';

const PROFILE_IDS = Object.keys(RIDE_PROFILES) as RideProfileId[];

interface RideProfilePickerProps {
  value: RideProfileId;
  onChange: (next: RideProfileId) => void;
}

export function RideProfilePicker({ value, onChange }: RideProfilePickerProps) {
  return (
    <label className="reverse-toggle">
      Ride profile
      <select value={value} onChange={(event) => onChange(event.target.value as RideProfileId)}>
        {PROFILE_IDS.map((id) => (
          <option key={id} value={id}>
            {RIDE_PROFILES[id].label}
          </option>
        ))}
      </select>
      <InfoTooltip content={RIDE_PROFILE_TOOLTIP} label="How ride profiles work" />
    </label>
  );
}
