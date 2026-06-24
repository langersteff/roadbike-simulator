import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  content: string;
  label?: string;
}

export function InfoTooltip({ content, label = 'More info' }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="info-tooltip" ref={wrapperRef}>
      <button
        type="button"
        className="info-tooltip__trigger"
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <Info width={14} height={14} strokeWidth={2} />
      </button>
      {open && (
        <span className="info-tooltip__bubble" role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
