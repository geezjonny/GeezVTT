# GeezVTT to-do

Compared `plan.md` with the latest entries in `progress.md` on 2026-11-22. This is a documentation comparison, not verification of the application. Later progress entries supersede earlier descriptions.

## Already implemented, pending user verification

- Local DD2VTT import and edited-map export, including embedded image, walls, doors, lights, and material metadata.
- 2D SVG and 3D Three.js views, pan/zoom, grid display, 3D orbit and Fit map.
- Shared editing tools for walls, doors, lights, floors, and tokens; selection, movement, snapping, fills, and geometry Undo/Redo.
- Floating menus/windows, snapping and grouped window movement, compact material palettes.
- Firebase NPC catalog reads and blank tokens, with local name, size, and HP editing.
- Portable named `.geezvtt` scene downloads/opening and unsaved-change warnings.
- Local dice rolls, advantage/disadvantage, recent local history, and optional animated dice.
- Manual fog of war in both views, with light-based reveal blocked by walls and closed doors.
- Clear/rain/snow weather and original/day/dawn/dusk/night presentation, saved with scenes and maps.

## 1. Reconcile architecture and plan

- [ ] Update the stale plan status saying application coding has not started.
- [ ] Record the implemented JavaScript/SVG/Three.js architecture against the originally planned TypeScript/React/PixiJS stack. Decide whether migration is still wanted before introducing a second stack.
- [ ] Keep Firebase RTDB authoritative for shared characters, scenes, combat, and events; the current prototype still keeps scene edits in local UI state.
- [ ] Reconcile the plan's manual-fog priority with the latest requested behavior: active lights cut through covered fog. Preserve that requested behavior unless explicitly changed.
- [ ] Document weather, time of day, exterior floor editing, and portable scenes as additions to the original plan.

## 2. Shared foundation — highest implementation priority

- [ ] Implement GM/player entry modes and the agreed `?gm=jonny` trusted-group control switch.
- [ ] Add PC selection/loading, duplicate-name handling, and stable character ID links after initial name matching.
- [ ] Define shared RTDB records for characters, scenes, active scene, combat, and transient events.
- [ ] Replace local-only authoritative scene state with shared data consumed by both renderers.
- [ ] Add automatic saving, connection status, reconnect handling, and state restoration after reload.
- [ ] Apply ownership rules: GM edits all; players move and edit only their characters and tokens through the player interface.
- [ ] Use updates to individual fields/objects rather than rewriting whole scenes on token movement.
- [ ] Keep camera, panel visibility, and local volume local.

## 3. Finish the playable tabletop milestone

- [ ] Load repository asset catalogs, including the existing map catalog, instead of relying only on local file import.
- [ ] Add token images and props with repository-relative asset references.
- [ ] Add adjustable grid scale and offset, and distance measurement.
- [ ] Add object resize controls, locking, hiding/revealing, and layer ordering where missing.
- [ ] Add shared pings.
- [ ] Add a shared saved-scene library and GM-controlled active scene selection for everyone.
- [ ] Preserve map/grid configuration, objects, visibility, walls, doors, lights, fog, and audio across scene switches and reconnects.
- [ ] Synchronize token movement, dice rolls, and shared dice history; add GM-private rolls and standard dice expressions.
- [ ] Reach the first playable milestone: one GM and two players can join, move their respective tokens, roll, switch scenes, and reload without losing saved state.

## 4. Complete visibility

- [ ] Calculate individual player vision from linked character tokens, including configurable sight and darkvision.
- [ ] Combine token vision with wall/door obstruction and illumination.
- [ ] Separate current visibility, remembered exploration, manual reveals, and hidden-object state; preserve exploration per player.
- [ ] Add GM preview of an individual player's view.
- [ ] Keep hidden tokens and props out of the player's revealed view.
- [ ] Extend fog coverage to painted floors outside the imported image, including negative coordinates.
- [ ] Decide whether finer fog boundaries are needed; current reveal and light obstruction use fog-cell centers and larger cells on large maps.
- [ ] Address consistency between fog obstruction and 3D lighting: fog tests all blocking walls/closed doors, while only eight eligible point lights currently cast visual shadows.
- [ ] Define the privacy boundary for player data; the current visual fog overlay is not access control.

## 5. Characters and combat

- [ ] Build persistent 2014/2024 D&D 5e sheets with per-character edition selection.
- [ ] Add stats, skills, saves, attacks, spells, resources, inventory, and notes.
- [ ] Add editable calculations, manual GM overrides, and sheet dice rolls.
- [ ] Keep characters/inventory independent of scenes and link tokens by character ID.
- [ ] Implement shared initiative, round counter, active turn, conditions, and HP updates.
- [ ] Track conditions without requiring comprehensive automated rules enforcement.

## 6. Campaign tools

- [ ] Add private and selectively shared journals/handouts.
- [ ] Add repository music/SFX catalogs and a GM soundboard with one-shots and looping audio.
- [ ] Synchronize playback controls, retain local player volume, and save scene audio settings.
- [ ] Add campaign export/import backups in addition to existing portable scene files.
- [ ] Finish collapsible character, journal, asset, and soundboard panels and combat initiative presentation.
- [ ] Confirm GitHub Pages hosting/deployment setup and asset paths for the integrated application.

## User verification backlog

Verification is left to the user. No tests, browser checks, visual inspections, or application validation commands were run for this comparison. Historical checks in `progress.md` do not establish that later changes pass.

- [ ] Verify current 2D/3D controls, right-click token editing versus orbit dragging, and touch behavior.
- [ ] Verify floating window movement, snapping, grouping/detachment, keyboard controls, and narrow-screen layouts.
- [ ] Verify all editor tools, Undo/Redo, out-of-bounds lights, exterior/negative-coordinate floors, and bounded fills.
- [ ] Verify Firebase NPC loading, permissions/errors, and current/legacy catalog compatibility.
- [ ] Verify floor/image/grid layering, point-light illumination and shadows, door transitions, the eight-light shadow limit, large-map performance, and resource disposal on map replacement.
- [ ] Verify fog cover/reveal and brushes, light reveal and wall/door blocking, disabled/removed lights, and retained manual reveals in both views.
- [ ] Verify weather, reduced-motion handling, and time-of-day brightness/tints.
- [ ] Verify DD2VTT and scene export/re-import with every edited layer, fog and environment settings, invalid-file handling, naming, and unsaved-change prompts.
- [ ] Verify dice animation, dependency loading, fallback behavior, and local history.
- [ ] When multiplayer exists, verify ownership, different player views, reconnect persistence, shared events/audio, selective journals, and backups.

## Repository housekeeping

- Latest recorded implementation commit: `e829aa4`, pushed to `origin/main`.
- This to-do document is saved locally; no additional commit or push was requested in this turn.
- Leave the unrelated `README.md` deletion and untracked `battlemap/mistyoaks.dd2vtt` untouched.
