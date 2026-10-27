import type { IncidentKind } from '../../sim/types';

const LABELS: Record<IncidentKind, string> = { fire: '火災', earthquake: '地震', casualty: '傷病者' };

/** 事案種別の専用アイコン（色は親要素の currentColor に従う） */
export function IncidentIcon({ kind, size = 18, title }: { kind: IncidentKind; size?: number; title?: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: `incident-icon incident-icon--${kind}`,
    role: title ? 'img' : undefined,
    'aria-label': title,
    'aria-hidden': title ? undefined : true,
  };
  switch (kind) {
    case 'fire':
      return (
        <svg {...common}>
          <title>{title ?? LABELS.fire}</title>
          <path d="M12 2c1 3.5 5 5.5 5 10.5A5 5 0 0 1 7 12.5c0-2 1-3.5 2.2-4.6.2 1.7 1 2.8 2.3 3.1C11 8.5 11 5 12 2z" />
          <path d="M12 21a2.5 2.5 0 0 1-2.5-2.5c0-1.6 1.4-2.4 2.5-4 1.1 1.6 2.5 2.4 2.5 4A2.5 2.5 0 0 1 12 21z" />
        </svg>
      );
    case 'earthquake':
      return (
        <svg {...common}>
          <title>{title ?? LABELS.earthquake}</title>
          <path d="M5 11l7-6 7 6v9H5z" />
          <path d="M12 9l-1.5 3 2.5 2-1.5 3" />
          <path d="M1 20h3M20 20h3" />
        </svg>
      );
    case 'casualty':
      return (
        <svg {...common}>
          <title>{title ?? LABELS.casualty}</title>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M12 7v10M7 12h10" />
        </svg>
      );
  }
}
