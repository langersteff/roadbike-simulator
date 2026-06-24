interface StartTimeInputProps {
  value: string;
  onChange: (next: string) => void;
}

export function StartTimeInput({ value, onChange }: StartTimeInputProps) {
  return (
    <label className="start-time">
      <span className="start-time__label">Start</span>
      <input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
