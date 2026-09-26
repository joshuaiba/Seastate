import type { SVGProps } from 'react';
import type { Sky } from '@seastate/shared';

/*
 * A small set of line icons drawn for SeaState: 24px grid, 1.6px stroke, round caps. Decorative by
 * default; pass a `title` when an icon carries meaning on its own.
 */

export type IconName =
  | 'wave'
  | 'wind'
  | 'drop'
  | 'tide'
  | 'thermometer'
  | 'sun'
  | 'sunrise'
  | 'sunset'
  | 'uv'
  | 'cloud'
  | 'rain'
  | 'run'
  | 'umbrella'
  | 'clock'
  | 'refresh'
  | 'chevron'
  | 'arrow-up'
  | 'arrow-down'
  | 'pin'
  | 'buoy'
  | 'spark';

const PATHS: Record<IconName, string> = {
  wave: 'M2 15c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3M2 19c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M6 11c0-3 2.5-6 6.5-6 2 0 3.5.8 4.5 2-2.5-.3-4.5 1-4.5 3.5',
  wind: 'M3 9h11a3 3 0 1 0-3-3M3 13h16a3 3 0 1 1-3 3M3 17h7',
  drop: 'M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5Z',
  tide: 'M3 7c2 0 2-2 4.5-2S9.5 7 12 7s2-2 4.5-2S18.5 7 21 7M12 11v9m-3.5-3.5L12 20l3.5-3.5',
  thermometer: 'M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0ZM12 9v7',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  sunrise: 'M3 19h18M7.5 19a4.5 4.5 0 0 1 9 0M12 3v6m-3-3 3-3 3 3M4.2 12.2l1.4 1.4M19.8 12.2l-1.4 1.4',
  sunset: 'M3 19h18M7.5 19a4.5 4.5 0 0 1 9 0M12 9V3m-3 3 3 3 3-3M4.2 12.2l1.4 1.4M19.8 12.2l-1.4 1.4',
  uv: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
  cloud: 'M7 18h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.3 11 3.5 3.5 0 0 0 7 18Z',
  rain: 'M7 14h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.3 7 3.5 3.5 0 0 0 7 14ZM8 17l-1 3M12 17l-1 3M16 17l-1 3',
  run: 'M13.5 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM7 21l3-5.5 3 2.5v4M6 11l3-3.5 4 1 2.5 3.5H19M10 15.5l2-5',
  umbrella: 'M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9ZM12 12v7a2 2 0 0 1-4 0M3 21h7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
  chevron: 'm9 6 6 6-6 6',
  'arrow-up': 'M12 19V5m-6 6 6-6 6 6',
  'arrow-down': 'M12 5v14m-6-6 6 6 6-6',
  pin: 'M12 21s7-6.1 7-11.5a7 7 0 0 0-14 0C5 14.9 12 21 12 21ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  buoy: 'M8 20h8M9 20l1.5-10h3L15 20M10.5 10 12 4l1.5 6M3 20c1.5 0 1.5-1 3-1M18 19c1.5 0 1.5 1 3 1',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
};

export function Icon({ name, size = 18, title, ...rest }: { name: IconName; size?: number; title?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
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
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${fromDeg + 180}deg)`, transition: 'transform 900ms var(--ease-out)' }}>
      <path d="M12 3.5 17 19l-5-3-5 3 5-15.5Z" fill={color} />
    </svg>
  );
}
