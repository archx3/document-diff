import type { Metadata } from 'next';
import { Workspace } from '../../../components/workspace';

export const metadata: Metadata = {
  title: 'Sample comparison',
  description: 'Two drafts of an agreement compared side by side, to try Collate before loading your own documents.',
};

export default function SampleComparisonPage() {
  return (
    <>
      <Workspace sample />
      <noscript>Collate needs JavaScript to compare documents.</noscript>
    </>
  );
}
