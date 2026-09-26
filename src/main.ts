import './styles.css';
import { App } from './ui/app';

const root = document.getElementById('app');
// The page on its own starts with the sample drafts.
if (root) new App(root, { sample: true });
