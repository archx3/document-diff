import type { Metadata } from 'next';
import { Workspace } from '../../components/workspace';

export const metadata: Metadata = {
  title: 'Compare documents',
};

export default function ComparePage() {
  return (
    <>
      <Workspace />
      <noscript>Collate needs JavaScript to compare documents.</noscript>
    </>
  );
}
