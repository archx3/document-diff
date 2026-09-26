import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './site.module.css';
import { ThemeToggle } from './theme-toggle';

export function Brand() {
  return (
    <Link href="/" className={styles.brand} aria-label="Collate home">
      <span className={styles.brandMark} aria-hidden="true">
        C
      </span>
      <span aria-hidden="true">ollate</span>
    </Link>
  );
}

/** The bar at the top of the site's pages: the name, then whatever the page adds, then the theme switch. */
export function SiteHeader({ children }: { children?: ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Brand />
        {children}
        <ThemeToggle />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerBar}>
        <Brand />
        <span>Compare two documents and copy changes across. Runs entirely in your browser.</span>
        <nav className={styles.footerLinks} aria-label="Footer">
          <Link href="/compare/new/">Start a comparison</Link>
          <Link href="/compare/sample/">Sample comparison</Link>
        </nav>
      </div>
    </footer>
  );
}
