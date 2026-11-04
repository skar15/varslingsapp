'use client';
import type { Light as LightLevel } from '@varsling/shared';
import { useT } from '@/lib/i18n';

const ICON: Record<LightLevel, string> = { none: '○', green: '◔', yellow: '!', red: '‼' };

/** Never colour alone: each light has a distinct icon and a text label (accessibility). */
export function Light({ level, compact = false }: { level: LightLevel; compact?: boolean }) {
  const t = useT();
  return (
    <span className={`light light-${level}`} role="img" aria-label={t(`light.${level}`)}>
      <span className="dot" aria-hidden>{ICON[level]}</span>
      <span>{compact ? t(`level.${level}`) : t(`light.${level}`)}</span>
    </span>
  );
}
