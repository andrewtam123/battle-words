import pools from '../dist/data/target-pools.json' with { type: 'json' };
import acceptedPools from '../dist/data/words.json' with { type: 'json' };
import { RoomService } from './room.js';
import { routeRequest } from './http.js';

// Bundled once per isolate, never copied into each room's persistent record.
const acceptedWords = new Set(Object.values(acceptedPools).flat());

export class BattleRoom extends RoomService {
  constructor(ctx, env) {
    super(ctx, env, { pools, acceptedWords });
  }
}

export default { fetch: routeRequest };
