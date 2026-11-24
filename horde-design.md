# Zombie Horde (co-op typing minigame)

Replaces the solo Zombie Typing runs on `minigame.html`. One shared arena: everyone moves with the arrow keys and types words. Four roles, each tied to a class. Spectators watch the same arena read-only.

## Architecture (GitHub Pages + Firebase RTDB, no server, no host)

Like the dice: every client simulates and draws the game itself, and the results are identical because the game is a **pure function of a seed and a shared input log**.

- **Session** `vtt/hordes/<id>/session`: `{ id, seed, startsAt, participants:[{pcId,name,class,role}] }`. `startsAt` is a Firebase server timestamp, so tick 0 means the same moment for everyone.
- **Input log** `vtt/hordes/<id>/events/<pcKey>/<seq>`: small events `{ t, k, ... }` where `t` is the sender's current tick (30 ticks a second). Kinds: `m` move `{dx,dy}`, `w` word submitted `{s}`, `r` class roll result `{total,nat}`. Players write only their own events. Movement events are sent only when the direction changes.
- **Replay:** `state(tick) = simulate(seed, participants, events up to tick)`. Events are sorted by `(t, pcId, seq)` so every client applies them in the same order.
- **Late events:** the timeline keeps a checkpoint of the state every 30 ticks. If an event arrives for a tick the client has already simulated, it restores the nearest earlier checkpoint and re-simulates forward. The game is small enough that this is cheap.
- **Render lag:** clients draw a few ticks behind "now" (default 4, about 130 ms) so most events have already arrived, and positions are interpolated between ticks for drawing only. Typing feedback (letters filling in) is local and immediate.
- **Spectators and late joiners** subscribe to the same log and replay it from tick 0. They write nothing.
- **End:** any client can compute the final results from the log. The GM page writes a results summary for the tabletop window.
- **Bandwidth:** only events are sent, a few small writes a second in total.
- **Cleanup:** a session older than 2 hours is ignored and deleted by the GM page.
- **Trust:** a client could post fake ticks or rolls. That is accepted for a friendly group, as with the rest of the app. The model clamps events to sane ticks.

### Determinism rules for `horde-model.js`

- Integer math only. Positions in 1/16 logical pixel units, speeds in units per tick. No `Math.sin`, `cos`, `atan2`, `pow`, `random` or `Date`. Use squared-distance comparisons instead of `sqrt`.
- Randomness only from a seeded integer generator (for example mulberry32 with `Math.imul`) stored in the state, so it can be checkpointed and cloned.
- State is plain JSON-able data. `clone(state)` is a deep copy.
- Iteration order is always fixed (arrays sorted by id, never object key order).
- Ties between events in the same tick are resolved by `(t, pcId, seq)`.

## Roles (assigned per character; the GM can override the class default)

Every role plays its own mini-game. Four of them have **two stances** that anyone can switch at any time with **Q / E** or by clicking the two buttons under the role panel (a tank cannot switch mid-charge). The stance shows under the character's name for everyone.

| Role | Default classes | Stance 1 (Q) | Stance 2 (E) |
| --- | --- | --- | --- |
| Tank | fighter, barbarian, paladin | **Attack:** arrow keys move, hold Space and release in the gold zone for a slam on everything in reach. | **Hold the line:** Space smashes her shield into the ground. She is rooted and takes a third of the damage, and **every zombie in the arena is drawn to her**. She keeps it up by tapping Space **in the green** on every pulse (a bar sweeps; the green is the window, a brighter centre is a perfect tap). Each green tap staggers zombies near her and shields the allies beside her. Misses and too-early taps wear down the shield's durability; at zero it shatters and cannot be replanted for 3 seconds. Switching stance lifts it. |
| Cutter | bard | **Cutting words:** DDR runes down four lanes; each clean hit damages the zombie nearest the gate. | **Hold person:** each clean hit pins the zombie nearest the gate (two at a high combo) with a spectral hand; others can still damage it. |
| Simon | artificer | **Heal:** click the four glyphs (sun, moon, star, rune) in the order they lit. A finished round sends one beam to the most hurt ally (twice the amount; a downed ally is revived; healing beyond full becomes shield). | **Damage:** the same game, but the round becomes a fireball at the zombie nearest the gate. |
| Pitch | wizard, sorcerer, warlock | **Inspiration:** slide your marker into the glowing zone and hold it: the party gets haste, damage reduction and a little shield. | **Cutting words:** the same game, but the match deals psychic damage to the three zombies nearest the gate. |
| Striker | ranger, rogue, monk | Arrow keys move. **Type a zombie's word** in range to shoot an arrow. | |
| Healer | cleric, druid | Arrow keys move. **Type a teammate's name** to heal them; three times to revive. | |
| Support | (word-caster) | Arrow keys move. **Type spell words**: haste, bless, hush, frost, blast, shield. | |
| Audience | (spectators, not in the party) | Type a zombie's word to shoot it from the stands at **half damage** (two hits make one damage). No roll, no character. | |

## Colours: everyone's look and magic use their own colour

Liora green, Lark pink, Ashara orange, Seris purple, Rurik cyan (`js/horde-colors.js`; guests fall back to their role's colour). Their sprites, dice, shields and every effect use it:

- **Seris:** purple slash arcs on everything her slam reaches; for Hold the line, a purple shield drops from above and stands in the ground, with a green timing bar and durability pips, faint lines pulling every zombie toward her, CLANG rings on each green tap, and a shatter when it breaks.
- **Liora:** green arrows with a green glow trail.
- **Lark:** a pink spectral hand slaps each held zombie down and keeps pressing on it while it is held; pink music notes fly to zombies for cutting words.
- **Ashara:** orange orbs circle her as she clicks the right glyphs; heal sends an orange beam with a travelling orb to the target, damage sends a fireball with a flame trail and leaves flames on the zombie.
- **Rurik:** inspiration raises a cyan hand with notes over every ally; cutting words sends cyan music notes.

## Rolls every wave

Rolls are automatic. At the start of the game and again **between every wave**, each player's page rolls that role's check from their sheet and posts it to the log. The minigame does not load Three.js: the game state remembers each player's last roll, and every screen draws it as an animated 2D d20 above that character's head, in their colour (tossed up, tumbling, settling on the real result with the total and tier underneath; a gold CRIT on a natural 20, a red Fumble on a 1). Old rolls in the log are history and are not animated again. The result is a tier 0-3 (below 10, 10-14, 15-19, 20+; a natural 20 adds a tier) that sets that wave's difficulty: a higher tier means a wider charge window, a slower rune song, a shorter Simon pattern, and a more forgiving pitch tolerance. The next wave starts 5 seconds after everyone has rolled, or when the 10 second timer runs out. Between waves downed players get back up and everyone recovers a quarter of their HP.

| Role | Check |
| --- | --- |
| Tank | Athletics |
| Striker | Perception |
| Healer | Medicine |
| Cutter | Performance |
| Simon | Investigation |
| Pitch | Arcana |

## Game rules

- **Arena:** 320x180 logical pixels, drawn pixelated and scaled to fill the whole window. Zombies spawn at the top and walk to the **gate** at the bottom (shared gate HP, 100).
- **Zombie speed:** the GM sets it from 1 to 5 before the game starts (default 1; 4 is the original pace, and each step is a quarter of that: 1 = 25%, 5 = 125%). It is part of the session, so everyone replays with the same speed.
- **Zombie types:** walker, runner (fast, weak), brute (long word, high HP).
- **Zombie behavior:** a zombie attacks the nearest of: a taunting tank within radius, otherwise the nearest player, otherwise the gate. Held zombies do nothing.
- **Waves:** 6 waves, growing in size; wave 6 ends with a boss brute.
- **Downed:** at 0 HP a player is downed until revived, or until the next wave break.
- **End:** won after wave 6, lost when the gate falls or everyone is down.

## Look (pixel art, drawn procedurally, no image files)

- Canvas rendered at 320x180 and scaled up with `image-rendering: pixelated`. The canvas fills the window and there are no menus: a hint at the top, the typing box for typing roles, and the GM's Start / End / speed controls at the bottom right (GM only).
- Two-frame walk cycles. Class bodies drawn from rectangles with a class colour. The PC's token portrait shows as a small head badge.
- Animated arrows with a trail and a hit spark. Heal sparkles. A taunt ring on the tank. A bard note burst. A freeze burst. Floating damage numbers. Screen shake on gate hits. A dark night backdrop with drifting fog.
- Respect `prefers-reduced-motion` (no shake, fewer particles) and the Graphics setting (Low = fewer particles).

## Files

- `js/horde-model.js`: the pure, deterministic simulation (`createGame`, `step`, `clone`) plus the `HordeTimeline` (event log, checkpoints, `stateAt`). No DOM, no Firebase. Fully unit-tested, including: two timelines fed the same events in different arrival orders give identical states; a late event triggers a correct re-simulation.
- `js/horde-sync.js`: session and event log reading and writing (reuses `watchTabletop`).
- `js/horde-view.js`: canvas renderer, interpolation and particles.
- `js/horde-page.js`: wiring on `minigame.html`; replaces `minigame-page.js`.
- `tests/horde.test.mjs`
