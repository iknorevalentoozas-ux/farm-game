# farm-game — CLAUDE.md

Co-op farming game (Overcooked-style). **Its own repo** — split out of `yellotalk-bot-main`
(was `farm-game/` there, history kept) on 2026-09-25. No code is shared with the bot; the only
link is a network connection (`server/src/bridge.js` → the YelloTalk bot's Socket.IO server on
port 5353, `BRIDGE_URL`). For what that side looks like, see `CLAUDE.md` in the sibling
checkout `D:\project\yellotalk-bot-main` (`backend/` = the bot server, `web-portal/` = its UI).

Run: `cd server && npm run dev` (port 5454) and `cd client && npm run dev` (port 5173), or
`run.bat` from the repo root. The bot backend must be up for the chat bridge; the game itself
works without it.

**Status: Phase 5, M1 done + animals/helpers pass** — 3D toon-shaded "cute" client (three.js, all
models built in code), carry-one-item Overcooked model, shared tools, animals (chicken/cow), helper
gadgets + small-team assists, 4 maps. Still open from the old plan: processing stations, level unlocks
by total stars.

**Deploy**: client → Vercel (Root Directory `client`, env `VITE_SERVER_URL` = the Render URL, baked in
at build time → redeploy after changing it); server → Render via `render.yaml` (Blueprint, `rootDir:
server`). On any public server `ADMIN_TOKEN` must be set (uploads at `/admin` need `x-admin-token`).
Render free has no disk → `farm.db` (best scores) and uploads are lost on restart; with a disk set
`FARM_DATA_DIR` (uploads go to `<FARM_DATA_DIR>/uploads`). The bridge only works if the bot backend
has a public URL (`BRIDGE_URL`); otherwise leave `BRIDGE_BOT_ID` unset.

## Game design (user decisions — read before changing)

- **No rooms / room codes.** Everyone who opens the client is in the same world and the same round;
  any number of players, join mid-round any time (user explicitly said "ไม่มีห้องดีกว่า").
- **Rounds, fully Overcooked-style**: 6-minute round (`ROUND_SEC`; user asked for +3 min on the original 3, star
  thresholds doubled with it) → results card (score, ⭐ by
  `stars` thresholds per map, best score) for `RESULTS_SEC` → next map in `MAP_ROTATION`. **Every
  round starts from zero** (coins, bought tools/upgrades, orders, items on the map). Only the best
  score per map persists (`farm_kv` key `best:<mapId>`).
- **Nobody online → the round is dropped silently** (`idle`, no score saved). The next join starts a
  fresh round on the next map — so reloading the page alone also advances the map (expected).
- **Hold exactly one item** (`item = {uid, k, water?, n?}`, `k` formats in the `content.js` header:
  `seed:<crop>`, `crop:<crop>`, `box:<crop>`, `feed:grain`, `tool:hoe|can|sickle|sprinkler|scarecrow`;
  `n` = uses left in a big seed/feed bag). Items live in a hand, on a
  counter `C`/rack `R` (1 slot each), in a packer `K`, or on the ground (thrown/dropped; ids `i<uid>`).
- **Three buttons**: primary (pick up / put down / plant / deliver / open seed box / shop / shoo
  pests), use (tool on target: till 1.2s, water 0.5s, reap 0.4s, refill can at pond — timed work,
  walking away cancels), throw (~3 tiles in facing direction, lands on a counter or the ground).
  Keyboard: WASD/arrows, Space/E primary, F/Q use, R/T throw.
- **Plot cycle**: raw → (hoe) tilled → (seed) planted → **grows only while moist** (one watering =
  `MOIST_MS` 12s, most crops need 2–3) → ready → pick by hand (1, +1 fertilizer) or sickle (2,
  +fertilizer; extras scatter on the ground) → back to raw, must re-till (🪱 good soil: stays tilled).
- **Tools are limited and shared** — `level.tools` placed on racks at round start
  (starter: hoe, can, can, sickle). Cans hold `CAN_CAP` water. More can be bought in the shop; the new
  one appears on the free counter nearest the shop. Tools can't be trashed.
- **Pack → deliver**: raw crop into packer `K` (1.5s) → `box:<crop>` → truck `B`, one box per press.
  Raw crops can't be delivered. Orders are lists of `box:<crop>` keys; teammates fill the same order.
- **Order time** = 35s + 8s/item + slowest grow time, clamped `ORDER_MIN_SEC`–`ORDER_MAX_SEC`
  (55–100), then + `ORDER_EXTRA_SEC` 10–30s by order size (user found the bare clamp too tight), +20s
  for orders spawned in the first 20s of a round (nothing is tilled yet) — effectively ~65–130s. Early finish pays up to +50%, expiry −10 score.
- **Animals** (user: "ทำระบบให้หลากหลาย"): `H` chicken → 🥚, `M` cow → 🥛 (blocking tiles, `a#` ids).
  Feed (`feed:grain`, free row in the seed box) → primary on a hungry animal → product after
  `CROPS[product].growMs` × map `growMul` → empty-hand primary collects `crop:egg|milk` → pack → deliver
  like any crop. No tilling/watering — the short loop small teams lean on. Orders draw from
  `level.crops` + `level.products` (products derived from the animals on the map).
- **Helpers** (user: "เพิ่มตัวช่วยมากกว่านี้"): gadgets `tool:sprinkler` (on the ground: moistens
  tilled plots within `SPRINKLER_RADIUS` every 4s) and `tool:scarecrow` (plots within
  `SCARECROW_RADIUS` are skipped by pests) — `helpers.js`, only active while lying on the ground, can be
  picked up/moved/thrown, can't be trashed, no "use" button. Upgrades: 🎒 seed bag (seed/feed bags
  with `n` = 3 uses; feed capped at the number of animals), 🪱 good soil, ⚙️ fast packer (0.6s),
  plus the old big can / boots / fertilizer. Client guide: `input/hint.ts` picks "what to do next"
  from the held item + orders → bouncing arrow over the target (only when >100px away) + a tip line;
  💡 button toggles it (localStorage `farm.hints`).
- **Random events** every 40–55s (`events.js`), weighted by `C.EVENTS` (good ones × `goodEvents`):
  rain (moistens all tilled plots, walk ×0.8 for 15s), pests (up to `scale.pests` growing plots not
  guarded by a scarecrow; primary on the plot within `scale.pestMs` or the crop is eaten — soil stays
  tilled), rush order (⚡ time ×0.6, reward ×1.5), 🐝 bees (growing crops +35% progress), 🎁 gift (a box
  an order still needs drops near the truck, else +15 coins), 🛒 market (shop pays ×2 for 20s).
- **Carrot and lettuce seeds are free** — every map has at least one, so a team at 🪙0 can always
  earn again. Don't give every crop on a map a price. Other seeds are cheap (3–6) and `START_COINS` is
  40: with pricier seeds bots on the desert map went broke after a few missed orders.
- **Difficulty scales with player count** (user: "สองคนทำไม่ทัน ตายพอดี") — `PLAYER_SCALE` in
  `content.js`, keyed 1..5+: concurrent orders, gap between orders, order-time multiplier, a cap on
  order size/variety, and a star-threshold multiplier. Orders use the *current* online count; stars use
  the round's time-weighted average (`G.avgPlayers()`), shown as 👥N in the HUD and on the results card.
  Map `stars` are the 4-player values. Measured with `scripts/playbot.js` — under the old flat rule
  (3 orders every 12s for everyone) 1–2 bots completed 1–2 orders and let ~15 expire.
  **Small teams also get assists** (user: "ถ้าคนเล่นน้อยต้องไม่ยาก"): longer moisture (`moistMul`), fewer
  and slower pests, smaller expiry penalty, more good events, free upgrades while the count stays low
  (`freeUps`, via `G.hasUpgrade` — they vanish if more people join; shop shows "ฟรี 🤝"), and a free
  sprinkler on a counter (`freeTools`, once per round, checked 8s after round start — the first joiner
  opens the round alone, so checking at start gave every team the solo freebies). HUD pill shows 🤝 +
  icons of the active assists. Bots, 6-min rounds, all 4 maps: solo 4–9 done / 0–1 expired (2–3★),
  duo 5–9 / 1–3 (1–2★); before this pass solo expired 3–4 and duo-on-snow went 3 / 6 (0★).
  Bots now also sell unwanted boxes clogging a packer, trash leftover feed, and drop on the ground
  when every counter is full — without that they looped or stood idle and the numbers were garbage.
- **Every map is validated at boot** (`checkReachable` in `level.js`): each plot/counter/packer needs a
  walkable neighbour reachable from a spawn, and each station type at least one reachable tile. The
  snow map once had a counter boxed in by the truck, a tree and the fence — the shop could put a bought
  tool there, where nobody could reach it.
- **Holding anything but a seed and pressing primary on a plot drops it on the ground in front** —
  standing among plots, every target is a plot, so before this a hoe or can could not be put down.

## server/ (Node + Express + Socket.IO + better-sqlite3, port 5454)

| File | Holds |
|---|---|
| `src/index.js` | Wiring order: `createGame` → `attachActions` → `attachOrders` → `attachEvents` → `world.attach({...hooks})` → assets → bridge; serves `public/` (`/admin`, uploads); `/api/health`, `/api/participants` |
| `src/content.js` | All data/balance: crops (+ animal products), `ANIMALS`, tools (+ gadgets), maps (ASCII legend in the header comment), shop, work times, order/event constants, `EVENTS` weights, `PLAYER_SCALE`. Test-only env knobs `FARM_ROUND_SEC`, `FARM_RESULTS_SEC`, `FARM_EVENT_GAP_MS=min,max`, `FARM_FORCE_EVENT=rain\|pests\|rush\|bees\|gift\|market`, `FARM_START_MAP=<mapId>` |
| `src/level.js` | `parseLevel` → plots `p#`, counters `c#` (rack flag), packers `k#`, stations, spawns (+ `checkReachable`); `moveWithCollision`/`collides`/`blockedAt`. **Collision must match `client/src/level/collision.ts` exactly** (same `SUBSTEP`/`NUDGE`) |
| `src/game.js` | `createGame()` → `G`: round state machine (`idle → playing → results`), `G.s` = the whole round (`plots, counters, packers, ground: Map, held: Map, work: Map, team, orders…`), plot helpers (`settlePlot`, `plotReady`, `moisten`, `clearPlot`), item helpers, views, coalesced `level:state` broadcast (100ms), 250ms tick running `onTick` hooks, `snapshot()` |
| `src/targets.js` | `listTargets(s)` / `findTarget`. `SERVER_REACH` 115 is wider than the client's `CLIENT_REACH` 80 because the server's view of you lags |
| `src/actions.js` | `act:primary {targetId}`, `act:use {targetId}`, `act:throw`, `act:seed {crop}`, `act:buy {id}`. `startWork` re-checks reach + that the same item is still held when the timer completes |
| `src/orders.js` | Spawn/expire on tick; `G.deliver(socket, uuid, item)` fills one unit; `G.ordersView`, `G.spawnOrder` |
| `src/events.js` | Random events on tick (weighted pick, see Game design) |
| `src/helpers.js` | Ground gadgets: sprinkler tick, `G.guarded(plot)` for scarecrows |
| `src/world.js` | Online players + movement (client-reported positions, validated; intent fallback); chat log (last 80, room + farm) for `chat:hello`; everything map/round-specific comes through hooks (`onJoin`, `getSpawn`, `move`, `collides`, `getSpeedMul`, `decorate(uuid) → {held, work}`, `nextColor`, `onLeave`, `getRoom`). Stores facing `fx/fy` and `color` |
| `src/db.js` | `data/farm.db` (gitignored; `FARM_DATA_DIR` overrides). Only players (names), `farm_kv` (best scores), `assets` — round state never touches the DB |
| `src/assets.js` + `public/admin/` | Asset admin (no login; uploads need `ADMIN_TOKEN` via `x-admin-token` when it is set — **always set it on a public server**). Upload `.glb` (or image) per key; the client uses it instead of the code-built model. Keys listed in `KEYS` in `public/admin/index.html` |
| `src/bridge.js` | `socket.io-client` **out** to the bot backend (5353). Room info (topic, owner, participants, the 10 speaker seats) + chat history from `bot-state-update` (has `botId`, so it can be filtered) and one `GET /api/bot/status/:botId` on connect (the backend's `participants` has no owner — it's only in `currentRoom.owner`, so the bridge puts the owner first in the list; login marks them 👑); live chat from `new-message` filtered by `BRIDGE_BOT_ID`. **Drops `new-message` starting with `🌾 `** — that's the farm's own relay echoing back (backend `addMessageForBot`s everything the bot sends), which used to show every farm message twice; in history such lines are turned back into `source:'farm'`. **Room chat is hidden by default** (user: only show it when the config is true):
`BRIDGE_SHOW_ROOM_CHAT=true` shows it; otherwise `index.js` drops live room messages and keeps only `source:'farm'`
lines from the history (farm → room relay and the 👥/🎤 tabs keep working). **Unset `BRIDGE_BOT_ID` → `bridge = null`**, normal dev mode: login falls back to manual name entry, room tabs say "not connected" |
| `scripts/playbot.js` | Balance tool: N bots join over sockets, BFS-path around the map and play the whole loop (till/plant/water/harvest/pack/deliver, share tools, shoo pests); prints score, stars, completed/expired, seconds left at delivery, idle %, stuck spots and every rejection toast |

### Socket protocol (port 5454 — not the bridge's connection to 5353)

- Client → server: `player:join {uuid, name}`, `player:move {dx, dy, x, y, cid, t}` (held direction + the
  client's own position, on change + every 100ms while moving + once on release), `act:*` above,
  `chat:send {text}`, `chat:hello` (chat panel mounted / reconnected → `chat:history`).
- **Movement is client-authoritative with a sanity check**: the server accepts `(x, y)` if it doesn't
  collide and isn't farther than `SPEED_PPS × speedMul × elapsed × 1.5 + 32`; otherwise it replies
  `you:correct {x, y}` and the client snaps. Replaced "server integrates the held direction + client eases
  toward it": on mobile RTTs the character slid on after release and the server lagged tens of px
  behind, so acting right on arrival got "too far". Without `x, y` (the balance bots) the server still
  integrates the intent in its tick. **Don't go back to "N px per event"** either (drifted ~25%).
- **Jitter-proofing** (user on Render: "กระตุก เดินไปละติด"): the speed check is a distance *budget* that refills
  over time (`BUDGET_*` in `world.js`, holds ~2.5s), not a per-packet limit — packets that stall and then arrive
  together used to fail "34px in 0ms", and each `you:correct` then rejected the packets still in flight → chains of
  snap-backs. `you:correct` carries a counter `cid` (on the player entry, also in `you` of snapshots, bumped by
  `teleport`); the client sends it with every `player:move`, the server silently drops moves with a stale `cid`.
  Simulated 5–8% packet stalls: 21–39 snap-backs per 25s before, 0 after. The client also re-applies
  `world:snapshot` on socket reconnect (it used to keep its old position/map).
- **Other players are interpolated** (`client/src/net/remote.ts`): each `player:move` carries `t` = the sender's
  `performance.now()`, the server keeps it as `ct` on the entry, viewers render each player ~250ms behind on
  *that player's* clock (a jittery uplink makes the server's own view stop-and-go; bots fall back to the
  `world:state` `t`). `World.ts` copies positions as-is, no extra lerp.
- **Corner correction + sub-steps** (`level.js` / `collision.ts`): moves are split into ≤4px steps on
  both sides (server ticks move 22px, client frames ~4px — without this they stopped up to 22px apart at
  walls), and walking straight into an edge with a gap within 20px slides you sideways into it. Before,
  being >18px off a tile centre (normal with a joystick) blocked every 1-tile gap.
- Server → client: `world:snapshot` (join), `world:state` (10Hz players incl. `held`, `work`, `fx/fy`,
  `color`), `level:state {plots, counters, packers, ground, serverNow}`, `round:start` (full snapshot;
  client rebuilds the scene), `round:update`, `round:end`, `orders:list`, `farm:team`, `ui:seeds`,
  `ui:shop`, `farm:toast {text}` (every rejection says why), `fx` (one-shot effects),
  `chat:message {source:'farm'|'room', …}`, `chat:history {messages, room}`, `room:info {topic, owner,
  participants[{uuid,name,avatar}], speakers[{position,locked,uuid,name,avatar,muted}]}`, `you:correct`.
- Chat from the farm is relayed into the real room as `🌾 {name}: {text}` when the bridge is up.
- **Growth is stored, not ticked**: plots keep `progressMs + moistUntil + lastTs`, settled whenever
  read. The server doesn't broadcast during growth; the client computes live progress as
  `progressMs + max(0, min(now, moistUntil) − state.serverNow)` (`liveStage()` in `World.ts`).

## client/ (Vite + TypeScript + three.js, port 5173)

| File | Holds |
|---|---|
| `src/main.ts` | Login → `fetchAssets().then(loadOverrides)` → socket join → `startGame()` + `mountChatPanel()` |
| `src/game.ts` | **Every socket listener, registered once** (not per round). Local movement + position reports, target pick, `computeActions()` (mirrors server rules so buttons never lie), keyboard, rAF loop. `window.__farm` test handle |
| `src/types.ts` | All wire types (`Snapshot`, `LevelState`, `PlayerView`, `ItemView`, …) |
| `src/input/target.ts` | `listTargets` / `pickTarget` — same formula as `server/src/targets.js` (point 40px ahead of facing, reach 80) |
| `src/input/hint.ts` | `computeHint()` — the "what next" guide (arrow + tip), client-only, recomputed 5×/s |
| `src/level/collision.ts` | Client copy of the server collision (must stay identical) |
| `src/render/Renderer.ts` | WebGL + CSS2D renderers, lights/shadows/fog/sky, follow camera (offset ×1.3 on portrait), `mergeStatic()` |
| `src/render/World.ts` | Builds the static map (merged per material) and syncs dynamic stuff: plots, counters/packers, ground items, players (walk anim, held item, work bar), target ring, fx |
| `src/render/models.ts` | Every model built from primitives. **Toon look**: `mat()` caches `MeshToonMaterial` (3-step gradient) by colour, rounded shapes (`rbox`, smooth spheres, `dome` for hats), pastel palette, `face()` (eyes + highlight + blush) on the farmer, animals, produce, truck, duck, scarecrow. A face must sit on the sphere's surface (z ≈ radius) or it's hidden inside; hats are domes above eye level or they cover the eyes from the high camera. Farmer hat = `colorIdx % 5` (straw, cap, beanie, bunny hood, sprout). Animals return an `AnimalRig` (head/tail/product) that World animates |
| `src/render/fx.ts` | Particles, throw arcs, floating text, rain |
| `src/render/overrides.ts` | `use(key, fallback)` — a GLB uploaded at `/admin` replaces the code model |
| `src/ui/Hud.ts` | Round pill, coins + held chip, 3 round action buttons (`setActions()` rebinds without rewriting DOM), seed picker, shop sheet, results card, toasts |
| `src/ui/ChatPanel.ts` | Tabs: 💬 chat (room + farm, history via `chat:hello`), 👥 people in the room (avatar, 👑 owner, "🌾 เล่นอยู่" if that uuid is in the farm), 🎤 the 10 speaker seats (owner on top, empty/locked/mic-on ring). Collapsed on phones with an unread count + a 4s peek of the latest message |
| `src/ui/OrdersPanel.ts` / `Joystick.ts` / `LoginOverlay.ts` | One-line order cards, DOM joystick (radius follows its size), login (room participants with avatars + manual name fallback) |
| `src/net/socket.ts` / `clock.ts` / `remote.ts` | Socket to the farm server only (never 5353); server clock offset; other players' interpolation buffer |
| `src/audio/engine.ts` | WebAudio core: context created on the first tap/key (login counts), suspended while the tab is hidden; `musicBus`/`sfxBus` → compressor; `tone()`/`hiss()` synth helpers; 🎵/🔊 toggles (localStorage `farm.music`/`farm.sfx`) |
| `src/audio/sfx.ts` | Every sound effect, synthesized (no audio files): `SFX[name](ctx, dest)` + `resultsJingle(stars, newBest)` |
| `src/audio/music.ts` | Small sequencer + one song per theme (grass/spring waltz/desert/snow) + `results`; melodies written as scale-degree strings (notation in the header). `setHurry()` = ×1.2 tempo + ticks for the last 30s |
| `src/audio/director.ts` | Decides what plays: server `fx`, toasts, `orders:list`/`round:update` diffs, my held item, packers/animals/plots finishing on their own (client-side time check), my `work` (tick loop), footsteps by theme, 10s countdown, rain loop. Positional (distance falloff + pan by x). **No server changes needed for sounds** |

- **Sound** (user: "เพิ่มระบบเสียงทุกส่วน แบบน่ารักๆ มีดนตรีด้วย"): all synthesized in code like the models — cute = short
  pops/blips/bells, soft volumes. `director.ts` maps toasts by their leading emoji (event toasts 🌧🐛🐝🎁🛒⚡ are silent —
  the event jingle comes from `round:update`; anything unprefixed from `actions.js` = soft "error" boop), so **a new
  non-error toast needs an emoji prefix or a rule there**. Testing: after a Vite HMR edit the game imports
  `sfx.ts?t=…`, so hook the URL from `performance.getEntriesByType('resource')`, not `/src/audio/sfx.ts`.
- Client `PREDICT_SPEED` must equal the server `SPEED_PPS` (the server's position check uses it).
- **Phone-sized UI** (`@media (max-width: 760px), (max-height: 520px)` in each UI file) — mobile is the main target,
  user: "ปรับ ui ให้ไม่บัง". The character is always mid-screen, so nothing may float there: smaller pill,
  buttons 76/58/46, joystick 100, one-line orders; top-right is one row `[⚙️][🪙]` (⚙️ opens a tray with 🎵🔊💡, closes
  after 5s) with chat collapsed to a 💬 icon under it; the held item is icon + water/uses only, in the empty corner cell of
  the action-button grid. Tip/toast: landscape → bottom strip between joystick and buttons, portrait → above the
  controls. Portrait ≤520px: pill left-aligned (centred it hit the coins), "ต่อไป"/assist icons dropped, the event
  banner becomes an emoji inside the pill (below the pill it covered the orders). Centred fixed text (`left:50%` +
  translate) needs `width: max-content` or it wraps at 50vw.
- **CSS2D labels: hide with `obj.visible`, never `style.display`** — CSS2DRenderer rewrites `display`
  every frame.
- `World.place()` **adds** to a model's own position offsets (overwriting them sank soil under grass).
  The outer ground plane sits at y=−0.3 so it doesn't cover the pond.
- Performance: static geometry merged per material, `pixelRatio ≤ 1.75`, PCFSoft shadow map 1024 on small screens (2048 otherwise).

## Testing

- **Run test servers on another port with their own data dir**:
  `FARM_DATA_DIR=<tmp> PORT=5455 FARM_ROUND_SEC=600 node src/index.js` (point a client at it with
  `VITE_SERVER_URL`). In-process stub tests of `game/actions/orders` also work.
- **Browser pane**: rAF stops when the pane is hidden, and the JS tool times out at ~45s. Set
  `window.__farm.manual = true` (the rAF loop skips — otherwise you double-step), then drive with
  `__farm.step(33)` in a loop, steering via `__farm.joystick.dx/dy`. Keep each call under ~40s.
  `resize_window` before loading (a 0×0 viewport breaks WebGL). `__farm.renderer.zoom = 0.35` moves the
  camera close for checking models (the pane's screenshot zoom doesn't crop).
- A headless second player is a few lines of `socket.io-client` (`player:join` + periodic
  `player:move`) — handy to check other players render/animate.
- **Balance runs**: one test server per case (`FARM_START_MAP`, own `PORT`/`FARM_DATA_DIR`) + `node
  scripts/playbot.js <url> <n> <label>`; run several in parallel, and **kill the test servers
  afterwards** — a leftover server keeps the port and the next run's bots silently hit the old code.
- **Chat/room tabs without a real room**: a ~60-line fake backend (express + socket.io on another port)
  answering `GET /api/bot/status/:id` and emitting `bot-state-update` / `new-message`, with the farm
  server started as `BRIDGE_URL=http://localhost:<port> BRIDGE_BOT_ID=fake`.
- Vite "Outdated Optimize Dep" after dependency changes → stop the preview, delete
  `client/node_modules/.vite`, restart.

```bash
cd farm-game/server && node --check src/*.js
cd farm-game/client && npx tsc --noEmit
```

**Never send a bridge test message into a real, live YelloTalk room without asking first** — a
`send-message` relay through `bridge.js` shows up to everyone in that room. Read-direction testing
(listening to `new-message`/participants) is safe to do freely.
