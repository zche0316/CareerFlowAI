import React, { useState } from 'react';

const steps = [
  'Profile building',
  'Career analysis',
  'Job matching',
  'Resume tailoring',
  'Interview practice',
];

/** Decorative ticks follow the pointer; the five labelled buttons remain keyboard accessible. */
export function FlowNavigation({
  current,
  onSelect,
  vertical = false,
}: {
  current: number;
  onSelect: (step: number) => void;
  vertical?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gap = vertical ? 6 : 12;
  const total = (steps.length - 1) * gap + 1;
  const ticks = Array.from({ length: total }, (_, i) => i);
  return (
    <nav
      className={vertical ? 'flow-ruler-live flow-vertical' : 'flow-ruler-live'}
      aria-label={vertical ? 'Journey navigation' : 'Application journey'}
    >
      <div
        className="flow-ruler-ticks"
        aria-hidden="true"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const position = vertical
            ? (event.clientY - box.top) / box.height
            : (event.clientX - box.left) / box.width;
          setHover(Math.max(0, Math.min(total - 1, position * (total - 1))));
        }}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const position = vertical
            ? (event.clientY - box.top) / box.height
            : (event.clientX - box.left) / box.width;
          onSelect(Math.max(0, Math.min(4, Math.round(position * 4))));
        }}
      >
        {ticks.map((i) => {
          const distance = hover === null ? 99 : Math.abs(i - hover);
          const weight = Math.exp(-(distance * distance) / 7);
          return (
            <span
              key={i}
              className={`${i <= current * gap ? 'on' : ''} ${i % gap === 0 ? 'major' : ''} ${i === current * gap ? 'current' : ''}`}
              style={{ '--weight': weight } as React.CSSProperties}
            />
          );
        })}
      </div>
      <div className="flow-ruler-labels">
        {steps.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-label={`${vertical ? 'Open ' : ''}${String(i + 1).padStart(2, '0')} · ${label}`}
            aria-current={current === i ? 'step' : undefined}
            onClick={() => onSelect(i)}
          >
            <span>{String(i + 1).padStart(2, '0')}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
