import { render } from 'preact';
import { App } from './App';
import { startUpdates } from './updates';
import { watchInstall } from './install';
import './styles.css';

startUpdates();
watchInstall();
// Bittet den Browser, die Sammlung nicht bei Speicherknappheit zu löschen.
navigator.storage?.persist?.().catch(() => undefined);
// Langes Drücken auf ein Kartenbild öffnet auf Android sonst das Browsermenü („Bild herunterladen“ …)
addEventListener('contextmenu', (e) => {
  if (e.target instanceof Element && e.target.closest('img, .binder')) e.preventDefault();
});

render(<App />, document.getElementById('app')!);
