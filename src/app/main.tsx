import { render } from 'preact';
import { App } from './App';
import { startUpdates } from './updates';
import './styles.css';

startUpdates();
// Bittet den Browser, die Sammlung nicht bei Speicherknappheit zu löschen.
navigator.storage?.persist?.().catch(() => undefined);

render(<App />, document.getElementById('app')!);
