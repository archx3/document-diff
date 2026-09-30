import type { ReactNode } from 'react';
import { Icon } from '../icons';
import styles from './replica.module.css';

/** The browser window a replica sits in. */
export function Frame({ address, label, children }: { address: string; label: string; children: ReactNode }) {
  return (
    <figure className={styles.frame} aria-label={label}>
      <div className={styles.chrome} aria-hidden="true">
        <span className={styles.lights}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.address}>
          <Icon name="lock" size={10} />
          {address}
        </span>
      </div>
      <div className={styles.window}>{children}</div>
    </figure>
  );
}
