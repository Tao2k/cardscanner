import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';

registerSW({ immediate: true });
// Bittet den Browser, die Sammlung nicht bei Speicherknappheit zu löschen.
navigator.storage?.persist?.().catch(() => undefined);

render(<App />, document.getElementById('app')!);
