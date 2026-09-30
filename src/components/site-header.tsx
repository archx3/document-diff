import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon } from './icons';
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

/** The site's own pages, in the header of every page that isn't the landing page. */
export const SITE_NAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/samples/', label: 'Samples' },
  { href: '/guides/', label: 'Guides' },
  { href: '/help/', label: 'Help' },
];

const FOOTER: ReadonlyArray<{ title: string; links: ReadonlyArray<[string, string]> }> = [
  {
    title: 'Product',
    links: [
      ['/compare/new/', 'Start a comparison'],
      ['/samples/', 'Samples'],
      ['/compare/sample/', 'Sample comparison'],
    ],
  },
  {
    title: 'Learn',
    links: [
      ['/guides/', 'Guides'],
      ['/guides/documents/', 'Comparing documents'],
      ['/guides/images/', 'Comparing images'],
      ['/guides/audio/', 'Comparing audio'],
      ['/help/', 'Help and shortcuts'],
    ],
  },
  {
    title: 'Legal',
    links: [
      ['/privacy/', 'Privacy'],
      ['/terms/', 'Terms of use'],
      ['/cookies/', 'Cookies and storage'],
      ['/accessibility/', 'Accessibility'],
      ['/licenses/', 'Open-source licenses'],
    ],
  },
];

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
      <div className={styles.footerGrid}>
        <div className={styles.footerAbout}>
          <Brand />
          <p>Compare two documents, images or recordings and copy changes across. Runs entirely in your browser.</p>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.title} className={styles.footerLinks} aria-label={col.title}>
            <p className={styles.footerTitle}>{col.title}</p>
            {col.links.map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className={styles.footerBase}>
        <span>© {new Date().getFullYear()} Collate</span>
        <span>
          <Icon name="lock" size={12} /> Your files never leave your browser.
        </span>
      </div>
    </footer>
  );
}

/**
 * A page of the site outside the workspace (samples, guides, help, the legal
 * pages): the header with the site's pages, the content, the footer.
 */
export function SitePage({ children, current }: { children: ReactNode; current?: string }) {
  return (
    <div className={styles.page}>
      <SiteHeader>
        <nav className={styles.nav} aria-label="Site">
          {SITE_NAV.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current === l.href ? 'page' : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className={styles.actions}>
          <Link href="/compare/new/" className={`${styles.pill} ${styles.primary} ${styles.small}`}>
            Start comparing
            <Icon name="arrow" className={styles.arrow} />
          </Link>
        </div>
      </SiteHeader>
      <main className={styles.main}>{children}</main>
      <SiteFooter />
    </div>
  );
}

/** A file under public/, wherever the site is served from. */
export function asset(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${path}`;
}
