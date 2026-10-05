// The Cloudflare Worker (docs/deploy.md). /ws opens a WebSocket to the
// relay room named by the room code (worker/room.js); every other path is a
// file of the game, served from the static assets (.assetsignore keeps the
// server, tests and docs out of them).

import { RELAY_PATH } from '../src/config.js';
import { parseRelayQuery } from './pairing.js';

export { RoomRelay } from './room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== RELAY_PATH) return env.ASSETS.fetch(request);

    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const query = parseRelayQuery(url.searchParams);
    if (!query.ok) return new Response(query.reason, { status: query.status });
    const room = env.ROOM.get(env.ROOM.idFromName(query.room));
    return room.fetch(request);
  },
};
