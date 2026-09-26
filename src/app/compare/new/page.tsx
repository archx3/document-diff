import type { Metadata } from 'next';
import Link from 'next/link';
import { NewComparison } from '../../../components/new-comparison';
import { SiteHeader } from '../../../components/site-header';
import site from '../../../components/site.module.css';

export const metadata: Metadata = {
  title: 'New comparison',
  description: 'Choose two versions of a document to compare side by side.',
};

export default function NewComparisonPage() {
  return (
    <div className={site.page}>
      <SiteHeader>
        <div className={site.actions}>
          <Link href="/compare/" className={`${site.pill} ${site.quiet} ${site.small}`}>
            See a sample comparison
          </Link>
        </div>
      </SiteHeader>
      <NewComparison />
    </div>
  );
}
