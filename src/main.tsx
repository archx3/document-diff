import './styles.css';
import { createRoot } from 'react-dom/client';
import { CompareApp } from './ui/app';
import { applyStoredTheme } from './ui/theme';

// The page on its own starts with the sample drafts, in the theme the reader chose.
applyStoredTheme();
const root = document.getElementById('app');
if (root) createRoot(root).render(<CompareApp sample />);
