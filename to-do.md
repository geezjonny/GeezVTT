# GeezVTT to-do

## Token art, rules, vision and campaign tools - 2026-11-23

- [x] Match token art by character name, use the repository catalog for image-name suggestions, and override through Token > Image name. Applies in Initiative, 2D and 3D, with existing fallback art when no image loads. Overrides survive scene export/import and live updates.
- [x] Add GM Resize to token, prop, portal, light, wall, floor, door and window context menus. Tokens retain half-square steps; segment resizing preserves the midpoint and door resizing adjusts adjoining wall openings. Light resizing changes its range. Door and compartment Lock/Unlock reuse their saved states; props with inventory use compartment controls.
- [x] Read individual sight/darkvision from Firebase senses. Player visibility uses controlled PC tokens, illumination, walls and closed doors; GM-hidden objects stay hidden from players. Dynamic player sight takes precedence over the GM's manual fog cover/reveal overlay. This does not add Firebase access control or remembered exploration. Sight defaults to 120 ft when no sight range is stored.
- [x] Add GM per-character 2014/2024 selection in Stats; default to 2024. Potion use takes a bonus action in 2024 and an action in 2014. Other configured consumables use an action. Out of initiative, do not charge turn resources. VTT use saves item spending, target HP/effects and the turn budget together through the online GM, with conditional writes and retry receipts. Standalone sheets direct combat item use to the VTT.
- [x] Healing potions automatically heal, respecting maximum HP; configurable instant healing/damage items spend quantity and apply HP changes, with damage spending temporary HP first. Recognized potions create timed Effects automatically, including giant strength, speed/AC, heroism temporary HP, named resistances and descriptive special effects. Reusing a spent dose cannot activate it for free.
- [x] Add item Throw with map destination picking, weight/strength, range and obstruction checks. Spends an attack during initiative and places one recoverable item in a small map compartment. Throw weight uses carrying capacity as a table rule: D&D does not specify a general maximum throwable weight. Hit/save outcomes and throwing damage remain manual.
- [x] Apply requested variant encumbrance: STR x 5 / x 10 thresholds, -10 / -20 ft, physical-roll disadvantage, size and recognized Powerful Build traits, and movement blocked above capacity. Known totals reject capacity-exceeding bag additions, transfers and compartment taking; unknown weights remain flagged and must be supplied for complete enforcement.
- [x] Add VTT Journal per linked player character, GM player selection, conditional saves and unsaved-note protection. Add GM Handouts for PNG/JPEG/WebP/GIF/TXT files up to 1 MB, pushed to selected linked PC tokens. Recipients receive the handout window.
- [x] Add the standard-width Soundboard window with ambience, SFX and music channels, GM Play/Stop, shared playback position, reconnect state, local volume and Enable audio. Repository catalogs are in ambience/, sfx/ and music/; update_indexes.py now rebuilds them. Audio URLs are also accepted. No audio files were supplied; the initial catalogs are empty.
- [ ] User verification of all new controls, 2D/3D/First Person presentation, imports/reloads, GM/player behavior, journal conflicts, handout delivery, audio unlock/reconnect/drift, item/turn atomicity and denied/conflicting Firebase writes. New regression cases are unrun.

Known limits: special potion rules such as charm targets, aerial movement, mind reading, attack-triggered expiration, damage-type resolution and additional Haste actions still need GM adjudication. Effect timers use the existing game-time controls. Hidden objects, journals and handouts follow the existing trusted-group Firebase model; UI filtering is not server authorization.

## Requested additions - 2026-11-23

- [x] Traps and triggers: tripwire segment drawing, single-cell pressure plates, levers, and buttons with SVG icons and code-built 3D models. Object > Trigger > Connect to selects a target; Connect opens collision/interact and state/damage/move settings. Supports multiple editable/deletable connections, activating-PC or specific-token damage, and picked movement destinations. Connections persist with stable object IDs in scene/map exports and shared updates. Implementation awaits user verification.
- [ ] Verify trap drawing and picking in 2D/3D/First Person; collision entry/crossing and movement paths; lever/button and chest/door interactions across GM/player sessions; open/close/lock/unlock, fixed/dice damage and temporary HP, specific targets, saved destinations, chained movement, deletion, export/import, reconnect, proximity/ownership denial, and Firebase conflict/error handling. New trigger regression cases are unrun. Player trigger resolution requires an online GM session. Movement effects relocate directly without wall blocking; linked PC damage uses conditional character saves, while other token damage is scene-local. Character damage and scene effects are separate saves; failed damage is reported for GM resolution.
- [x] Compartments for crates/chests: right click > Compartment > Contents > adventuring tier 1–4 generates random coins, gear, and tier-matched magic items. Generation adds to existing contents. Compartment > Open offers Add SRD Item and Add Custom Item. Clicking an item transfers one unit; Take All transfers all remaining contents to the selected controlled PC. Coins credit the coin purse. Bag additions, compartment removal, and retry receipts save together using a conditional world write. Implementation awaits user verification.
- [x] Item weights and calculated carrying limits: SRD weights, editable custom weights, stack totals, coin weight, current STR and creature-size capacity, unknown-weight warnings, and over-capacity status. Implementation awaits user verification.
- [x] Variant encumbrance penalties, recognized Powerful Build traits and known-weight capacity enforcement (see latest entry).
- [x] Configured consumables: Item > Use > target PC > Confirm use. Source consumption and target modifiers save together; target copies expire/end through the existing Effects controls and cannot reactivate for free. Available in the VTT and standalone sheet. Implementation awaits user verification.
- [x] Instant healing/damage consumables and automatic recognized potion definitions (see latest entry).
- [ ] Non-PC consumable targets and effect configuration following transferred items.

Current implementation notes: tier loot uses bounded SRD pools and app-defined coin ranges rather than reproducing DMG hoard tables; items without a known reference or custom weight remain explicitly unknown. Compartment taking requires an online GM session and a nearby selected PC. Conditional compartment saves require Firebase write access at `v2/worlds/gaia`; targeted consumables require write access at the entities collection. Existing trusted-group permissions remain in effect.

Regression cases were added for weight totals, metadata preservation, single/all taking, coins, tier boundaries, targeted effects, conditional conflicts, ownership, and repeated requests. None were run; all verification is left to the user.

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

- [x] Update the stale plan status saying application coding has not started.
- [x] Record the implemented JavaScript/SVG/Three.js architecture against the originally planned TypeScript/React/PixiJS stack. Continue the existing stack; any migration requires an explicit decision before introducing a second stack.
- [ ] Keep Firebase RTDB authoritative for shared characters, scenes, combat, and events; shared scene/live streams and field patches exist alongside local editing state. User verification of persistence and reconnect behavior remains outstanding.
- [x] Reconcile the plan's manual-fog priority with the latest requested behavior: active lights cut through covered fog. Preserve that requested behavior unless explicitly changed.
- [x] Document weather, time of day, exterior floor editing, and portable scenes as additions to the original plan.

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

- [x] Load repository battlemap and saved-scene catalogs through the Load library, with local file opening also available. Implementation awaits user verification.
- [x] Add repository token PNG assets and `token/index.json`, with `update_indexes.py` to rebuild the filename catalog alongside battlemap and scene indexes. Initiative portraits match lowercase names with underscores; missing images retain letters. Implementation awaits user verification.
- [x] Add a token image-name picker and map-token portraits.
- [ ] Finish repository-relative prop asset support where missing.
- [x] Add distance measurement, including shared measurement events and distance labels at 5 feet per square. Implementation awaits user verification.
- [ ] Add adjustable grid scale and offset.
- [ ] Add object resize controls, locking, hiding/revealing, and layer ordering where missing.
- [x] Add shared pings through tabletop session events. Implementation awaits user verification.
- [x] Add a repository saved-scene library and GM-controlled active scene loading, published to player sessions. Scene files are saved locally and cataloged in the repository; this is not an in-app Firebase scene-library manager. Implementation awaits user verification.
- [ ] Preserve map/grid configuration, objects, visibility, walls, doors, lights, fog, and audio across scene switches and reconnects.
- [ ] Synchronize token movement, dice rolls, and shared dice history; add GM-private rolls and standard dice expressions.
- [ ] Reach the first playable milestone: one GM and two players can join, move their respective tokens, roll, switch scenes, and reload without losing saved state.

## 4. Complete visibility

- [x] Calculate individual player vision from linked character tokens and Firebase sight/darkvision.
- [x] Combine token vision with wall/door obstruction and illumination.
- [ ] Separate current visibility, remembered exploration, manual reveals, and hidden-object state; preserve exploration per player.
- [ ] Add GM preview of an individual player's view.
- [x] Keep hidden tokens and props out of the player's revealed view.
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

- [x] Add per-character journals and selectively pushed handouts; existing trusted-group Firebase access applies.
- [x] Add repository ambience/music/SFX catalogs and a GM soundboard with one-shots and looping audio.
- [x] Synchronize playback controls and retain local player volume.
- [ ] Save audio settings per scene; current shared playback persists across scene changes.
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

- Save, commit, and push requested for token portraits/assets, the index updater and its unrun regression case, and progress/TODO updates.
- Verify the token index updater, Initiative portraits and letter fallback. Verification is left to the user; no checks were run.
- Reconcile older foundation, character, and multiplayer checklist entries with newer implementation notes before treating them as missing features.
- Leave the unrelated `scene/blackpearl-whole.geezvtt` modification and the ZIP archive inside `token` out of this commit.
