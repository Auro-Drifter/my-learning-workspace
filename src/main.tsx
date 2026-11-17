import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import './workbench.css';
import './desktop.css';
import './dialog-glass.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
