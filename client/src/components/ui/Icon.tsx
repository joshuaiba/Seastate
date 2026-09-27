import type { SVGProps } from 'react';
import type { Sky } from '@seastate/shared';

/*
 * The few line icons the page uses, drawn for SeaState: 24px grid, 1.5px stroke, round caps, the same
 * stroke as the weather glyphs below. Icons appear only where they carry direction or an action.
 * Decorative by default; pass a `title` when an icon carries meaning on its own.
 */

export type IconName = 'refresh' | 'chevron' | 'arrow-up' | 'arrow-down';

const PATHS: Record<IconName, string> = {
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
  chevron: 'm9 6 6 6-6 6',
  'arrow-up': 'M12 19V5m-6 6 6-6 6 6',
  'arrow-down': 'M12 5v14m-6-6 6 6 6-6',
};

export function Icon({ name, size = 18, title, ...rest }: { name: IconName; size?: number; title?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Weather glyphs for a sky, with a moon instead of a sun at night. */
export function WeatherIcon({ sky, night = false, size = 22, title }: { sky: Sky; night?: boolean; size?: number; title?: string }) {
  const sun = night ? (
    <path d="M15.5 4.5a6 6 0 1 0 5 8.6 5 5 0 0 1-5-8.6Z" stroke="var(--ink-2)" />
  ) : (
    <g stroke="var(--sun)">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21M5.6 5.6l1.3 1.3M17.1 17.1l1.3 1.3M5.6 18.4l1.3-1.3M17.1 6.9l1.3-1.3" />
    </g>
  );
  const smallSun = night ? (
    <path d="M11 3.5a4.2 4.2 0 1 0 4.4 6 3.5 3.5 0 0 1-4.4-6Z" stroke="var(--ink-2)" />
  ) : (
    <g stroke="var(--sun)">
      <circle cx="9" cy="8.5" r="3" />
      <path d="M9 2.8v1.1M3.3 8.5h1.1M5 4.5l.8.8M13 4.5l-.8.8" />
    </g>
  );
  const cloud = (dy = 0, stroke = 'var(--ink-2)') => (
    <path transform={`translate(0 ${dy})`} d="M7.5 19h9.8a3.7 3.7 0 0 0 .5-7.37A5.6 5.6 0 0 0 7 12.3a3.35 3.35 0 0 0 .5 6.7Z" stroke={stroke} />
  );
  const drops = (d: string) => <path d={d} stroke="var(--cool)" />;

  let body;
  switch (sky) {
    case 'clear':
      body = sun;
      break;
    case 'mostly-clear':
      body = (
        <>
          {smallSun}
          <path d="M10 19h7.5a2.8 2.8 0 0 0 .4-5.57 4.2 4.2 0 0 0-7.9.6A2.5 2.5 0 0 0 10 19Z" stroke="var(--ink-2)" />
        </>
      );
      break;
    case 'partly-cloudy':
      body = (
        <>
          {smallSun}
          {cloud(0)}
        </>
      );
      break;
    case 'overcast':
      body = (
        <>
          <path d="M9 8.5a4.5 4.5 0 0 1 8.2.6" stroke="var(--ink-3)" />
          {cloud(0)}
        </>
      );
      break;
    case 'fog':
      body = <path d="M4 9h16M3 13h18M5 17h14" stroke="var(--ink-2)" />;
      break;
    case 'drizzle':
      body = (
        <>
          {cloud(-3)}
          {drops('M9 19.5v1M13 19.5v1M17 19.5v1')}
        </>
      );
      break;
    case 'rain':
    case 'showers':
      body = (
        <>
          {cloud(-3)}
          {drops('M9 18.5l-1 3M13 18.5l-1 3M17 18.5l-1 3')}
        </>
      );
      break;
    case 'thunder':
      body = (
        <>
          {cloud(-3)}
          <path d="m12.5 16-2 3.5h3l-2 3.5" stroke="var(--sun)" />
        </>
      );
      break;
    case 'snow':
      body = (
        <>
          {cloud(-3)}
          {drops('M9 19.5h.01M13 20.5h.01M17 19.5h.01')}
        </>
      );
      break;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {body}
    </svg>
  );
}

/**
 * An arrow for a direction that something comes FROM, drawn pointing the way it's going (downwind),
 * the way wind arrows read on a map.
 */
export function DirectionArrow({ fromDeg, size = 18, color = 'currentColor' }: { fromDeg: number; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${fromDeg + 180}deg)`, transition: 'transform 600ms var(--ease-out)' }}>
      <path d="M12 3.5 17 19l-5-3-5 3 5-15.5Z" fill={color} />
    </svg>
  );
}
