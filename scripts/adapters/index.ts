import { riftbound } from './riftbound';
import type { GameAdapter } from './types';

export const adapters: Record<string, GameAdapter> = {
  [riftbound.gameId]: riftbound,
};
