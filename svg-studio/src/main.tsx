import './styles.css';
import { createRoot } from 'react-dom/client';
import { loadSaved, sampleDoc, startAutosave } from './state/persist';
import { createInitialState, initStore } from './state/store';
import { App } from './ui/App';
import { applyStoredTheme } from './ui/theme';

applyStoredTheme();
const saved = loadSaved();
initStore(saved ? createInitialState(saved.doc, saved.name, saved.settings) : createInitialState(sampleDoc(), 'sun'));
startAutosave();

const root = document.getElementById('app');
if (root) createRoot(root).render(<App />);
