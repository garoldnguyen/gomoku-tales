# Relay server on Cloudflare

Online play across computers goes through a small relay server: a
Cloudflare Worker with one Durable Object per room. The same Worker also
serves the game files. Playing locally (`python3 -m http.server 8000`) does
not need it.

## Files

- `worker/index.js`: the Worker. `/ws` (`RELAY_PATH` in `src/config.js`)
  checks the room code (`ROOM_CODE_LENGTH` characters of
  `ROOM_CODE_ALPHABET`) and the role (`host`, `guest` or `spectator`) and
  forwards the WebSocket to the Durable Object named by the code. Every other
  path goes to `env.ASSETS.fetch`, the static game files.
- `worker/room.js`: `RoomRelay`, the Durable Object (WebSocket hibernation
  API). Host messages go to the guest and every spectator, guest messages go
  to the host only, and a spectator that sends anything is closed. When the
  host or the guest closes, the other side gets
  `{ type: 'leave', from: <closed peer id>, to }`. The last `seats`, `state`,
  `start`, `result`, `new-game` and `rematch-status` messages of the host are
  kept in storage and replayed, in that order, to each new spectator.
- `worker/pairing.js`: the pure rules, tested by `tests/worker.test.js`:
  - `decideJoin(current, role)` gives `accept`, `full`, `noRoom` or `taken`.
    A second host is `taken`; a guest or spectator without a host is
    `noRoom`; a second guest, or a spectator past `SPECTATOR_LIMIT`, is
    `full`. A refused join gets HTTP 404 (`noRoom`) or 409 (`full`, `taken`)
    instead of a WebSocket, so the browser's `opened` promise rejects.
  - `checkFrame(raw, limits)` gives `ok`, `too-large` (more than
    `MAX_FRAME_BYTES`, socket closed with 1009), `too-fast` (more than
    `MAX_FRAMES_PER_SECOND` frames in a second, closed with 1008) or
    `bad-json` (not JSON text of an object with a string `type`, closed with
    1008).
  - `snapshotFor(store)` gives the replay list for a new spectator.
- `worker/limits.js`: `MAX_FRAME_BYTES`, `MAX_FRAMES_PER_SECOND`,
  `SPECTATOR_LIMIT` and `EMPTY_ROOM_CLEANUP_MS`, re-exported from
  `src/config.js` (the numbers are typed only there). A room with no socket
  left deletes its stored snapshot after `EMPTY_ROOM_CLEANUP_MS`.
- `wrangler.toml`: the Worker, the static assets of the repo root (binding
  `ASSETS`, the Worker runs first only for `/ws`), the Durable Object binding
  `ROOM` and the migration `v1` (`new_sqlite_classes = ["RoomRelay"]`).
- `.assetsignore` (repo root, gitignore syntax): keeps `worker/`, `tests/`,
  `docs/`, `tools/`, `shots/`, `.millstone/`, `.git/`, `node_modules/`,
  `.wrangler/`, `wrangler.toml`, `package.json` and `package-lock.json` out
  of the public site.

## Local test

To play online rooms through the local relay without changing
`ONLINE_TRANSPORT` in `src/config.js`, start `npx wrangler dev` (see
below) and open:

    http://localhost:8787/?transport=websocket

The URL parameter `transport` with the value `websocket` or `broadcast`
overrides `ONLINE_TRANSPORT` (`chooseTransport` in `src/net/transport.js`).
It works only when the page is served from `localhost`, `127.0.0.1` or
`::1`. On any other host, such as the deployed domain, and for any other
value, the parameter is ignored and `ONLINE_TRANSPORT` decides. Open the
same URL in a second window or browser to join the room. The lobby hint
follows the chosen transport (no same-browser line for `websocket`).

## Manual local test with wrangler dev

Needs Node.js and an internet connection the first time (npx downloads
wrangler). No Cloudflare account is needed for `wrangler dev`.

1. In the repo root run:

       npx wrangler dev

   It prints a local address, usually `http://localhost:8787`. Wrangler
   creates a `.wrangler/` folder for its local state; do not commit it.
2. Open `http://localhost:8787`. The game loads as from
   `python3 -m http.server 8000`.
3. Check that private files are not served. Each of these must answer 404
   (or show the game page, never the file itself):
   - `http://localhost:8787/worker/index.js`
   - `http://localhost:8787/tests/worker.test.js`
   - `http://localhost:8787/wrangler.toml`
   - `http://localhost:8787/package.json`
   - `http://localhost:8787/docs/deploy.md`
4. Check the relay from the browser console of that page (room code
   `ABCDE`):

       const host = new WebSocket('ws://localhost:8787/ws?room=ABCDE&role=host');
       host.onmessage = (e) => console.log('host got', e.data);
       const guest = new WebSocket('ws://localhost:8787/ws?room=ABCDE&role=guest');
       guest.onmessage = (e) => console.log('guest got', e.data);

   - `host.send(JSON.stringify({ type: 'ping', from: 'h1' }))` shows
     `guest got ...`; `guest.send(JSON.stringify({ type: 'ping', from: 'g1' }))`
     shows `host got ...`.
   - A second guest, `new WebSocket('ws://localhost:8787/ws?room=ABCDE&role=guest')`,
     fails to open (409). A guest of another code, for example `room=ZZZZZ`,
     fails too (404). A bad code such as `room=ABC0E` fails (400).
   - `host.send(JSON.stringify({ type: 'seats', from: 'h1', seats: {} }))`,
     then open a spectator
     (`const s = new WebSocket('ws://localhost:8787/ws?room=ABCDE&role=spectator'); s.onmessage = (e) => console.log('spectator got', e.data);`):
     it receives the seats message at once. `s.send('{}')` closes it.
   - `guest.close()` shows `host got {"type":"leave","from":"g1",...}`.
   - `host.send('not json')` closes the host socket (bad-json), and the guest,
     if open, receives a leave message with `from: "h1"`.
5. Stop wrangler with Ctrl+C.

## Deploy

From the owner's machine: `npx wrangler deploy` (asks to log in to
Cloudflare the first time). Online rooms use the relay only once
`ONLINE_TRANSPORT` in `src/config.js` is `'websocket'`.
