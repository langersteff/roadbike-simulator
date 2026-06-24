import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { parseGpx, type ParsedGpx, GpxParseError } from '../../lib/gpx/parse';

interface GpxUploadProps {
  currentName: string | null;
  onUpload: (parsed: ParsedGpx) => void;
}

export function GpxUpload({ currentName, onUpload }: GpxUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseGpx(text, file.name);
      onUpload(parsed);
    } catch (err) {
      const message = err instanceof GpxParseError ? err.message : 'Failed to read GPX file.';
      setError(message);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="gpx-upload">
      <button
        type="button"
        className="btn btn--ghost gpx-upload__button"
        onClick={() => inputRef.current?.click()}
      >
        <Upload width={16} height={16} strokeWidth={2} />
        {currentName ? 'Replace GPX' : 'Upload GPX'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".gpx,application/gpx+xml,application/xml,text/xml"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {currentName && <span className="gpx-upload__name">{currentName}</span>}
      {error && <span className="gpx-upload__error">{error}</span>}
    </div>
  );
}
