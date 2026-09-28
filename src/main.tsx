import './styles.css';
import { createRoot } from 'react-dom/client';
import { CompareApp } from './ui/app';
import { restoreSession } from './ui/session';
import { applyStoredTheme } from './ui/theme';

// The page on its own starts with the sample drafts, in the theme the reader chose.
applyStoredTheme();
const root = document.getElementById('app');
// A reload carries on with the comparison the page had.
if (root) void restoreSession('single').then((restored) => createRoot(root).render(<CompareApp sample session="single" restored={restored} />));
