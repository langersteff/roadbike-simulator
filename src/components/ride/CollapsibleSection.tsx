import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface CollapsibleSectionProps {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  actions,
  className,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`ride-section collapsible${className ? ` ${className}` : ''}`}>
      <div className="collapsible__header">
        <button
          type="button"
          className="collapsible__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronDown width={18} height={18} /> : <ChevronRight width={18} height={18} />}
          <h2 className="ride-section__title collapsible__title">{title}</h2>
          {!open && summary && <span className="collapsible__summary">{summary}</span>}
        </button>
        {open && actions && <div className="ride-section__title-actions">{actions}</div>}
      </div>
      {open && <div className="collapsible__body">{children}</div>}
    </section>
  );
}
