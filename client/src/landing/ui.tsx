import { Icon } from '../components/ui/Icon';
import styles from './ui.module.css';

/** The SeaState mark: a swell line under the sun. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 15c3 0 3-3.5 6-3.5s3 3.5 6 3.5 3-3.5 6-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="16.5" cy="7" r="2.6" fill="var(--sun)" />
    </svg>
  );
}

/** The way into the dashboard. `quiet` is the secondary, text-only form. */
export function EnterLink({
  href = '/app/',
  children,
  quiet = false,
}: {
  href?: string;
  children: string;
  quiet?: boolean;
}) {
  return (
    <a className={quiet ? styles.quiet : styles.enter} href={href}>
      {children}
      <Icon name="chevron" size={16} className={styles.chevron} />
    </a>
  );
}

/** A small label above a section's statement. */
export function Kicker({ children }: { children: string }) {
  return <p className={styles.kicker}>{children}</p>;
}
