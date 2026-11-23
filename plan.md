# GeezVTT implementation plan

Status: Agreed product and implementation plan. Application coding has not started.

## Foundation

GeezVTT is a feature-rich, browser-based D&D virtual tabletop with an Owlbear Rodeo-style map-first interface.

- Host the static application on GitHub Pages.
- Store maps, token images, props, music, and sound effects in the GitHub repository. Reference assets by relative path and organize them through asset catalogs.
- Treat Firebase Realtime Database (RTDB) as the source of truth for shared application state, including persistent characters, saved scenes, and live multiplayer state. This is the highest-priority architectural principle.
- Support both 2014 and 2024 D&D 5e with built-in character sheets and a rules edition selected per character.
- Keep GM overrides available for character, combat, and scene values.

## Entry and permissions

The URL parameter `?gm=jonny` enables GM editing controls. Without it, the application uses the player interface. This is a trusted-group access switch.

Players select or enter a PC character name. Load that character from Firebase and initially match scene tokens by character name. Retain an internal character ID link after matching so renaming does not break existing links. Present duplicate-name conflicts to the GM.

| Action | GM | Player |
| --- | --- | --- |
| Import and configure scenes, maps, and grid | Edit | View active scene |
| Add or remove tokens and props | Edit | View revealed objects |
| Move tokens | Any token | Own character's tokens |
| Change walls, doors, lights, and fog | Edit | See resulting visibility |
| Control music and soundboard | Edit and play | Listen and adjust local volume |
| Edit sheets and inventory | Any character | Own character |
| Manage initiative and conditions | Edit | View and roll own initiative |
| Create and share journals | Edit | Read shared entries |
| Roll dice and ping | Yes | Yes |

## Required features

### Tabletop and GM tools

- Pan and zoom.
- Square grid with adjustable scale and offset.
- Grid snapping, token sizing, and distance measurement.
- Tokens and props, with selection and layer ordering.
- Add, move, resize, lock, hide, reveal, and remove objects.
- Shared pings.
- GM preview of an individual player's view.

### Scenes and map import

- GM selects the active scene for everyone.
- Preserve all scene data when switching scenes or reconnecting: map references, grid settings, tokens, props, positions, visibility, walls, door states, lights, fog exploration, and audio configuration.
- Import `.dd2vtt` maps, including their image, grid scale, walls, portals/doors, and lights.
- Provide editing tools to correct imported data.
- Keep character sheets and inventory independent of individual scenes.

### Visibility

- Calculate individual player vision through their character's linked tokens.
- Configurable sight and darkvision.
- Walls obstruct sight.
- Open and closed doors affect visibility.
- Lights illuminate areas.
- GM can manually cover or reveal map areas with fog.
- Preserve remembered exploration.
- Manual GM fog takes priority over calculated visibility.
- Hidden tokens and props remain hidden from players until revealed.

### Characters and inventory

- Built-in persistent sheets for 2014 and 2024 D&D 5e, with edition selected per character.
- Editable stats, skills, saves, HP, attacks, spells, resources, inventory, and notes.
- Editable calculations and manual GM overrides.
- Characters persist across scenes using Firebase RTDB.
- Scene tokens reference their linked character.

### Combat and dice

- Shared initiative order, round counter, and active turn.
- Conditions, HP changes, and GM adjustments.
- Conditions initially track state without automatically enforcing every rule.
- Standard dice expressions, advantage/disadvantage, and rolls from sheets.
- Shared dice history and GM-private rolls.

### Journals

- GM-private journal entries.
- Handouts and entries shared with everyone or selected characters.

### Soundboard

- Load sound effects and music from repository assets.
- GM-triggered one-shot effects and looping ambience/music.
- Shared playback controls and individual player volume controls.
- Save scene audio configuration.

## Interface

Use a map-first layout with compact toolbars around the tabletop. Show initiative during combat. Provide collapsible panels for characters, journals, assets, and the soundboard.

## Technical architecture

- Make almost all application behavior data-driven, with shared state and configuration stored in Firebase RTDB.
- Support multiple independent renderers and partial views of the application that subscribe to the same RTDB data. Each renderer or view reads the data it needs and may write updates when permitted.
- Keep the shared data model independent of any renderer. Renderers project database state; authoritative shared state must not live only inside a renderer or UI component.
- Keep temporary local presentation state, such as camera position, panel visibility, and individual volume, local unless explicitly shared.
- TypeScript and React for the interface and character sheets.
- PixiJS for tabletop rendering, tokens, lighting, and fog.
- Firebase RTDB with separate records for characters, scenes, combat, and transient events such as pings.
- Target individual objects and fields in multiplayer updates instead of rewriting entire scenes when a token moves.
- Keep media files outside RTDB; store repository-relative references and settings in the database.
- Use stable character IDs after the initial name match.
- Provide automatic saving, connection status, reconnect handling, and campaign export/import for backups.

## Build sequence and verification

### 1. Shared foundation

Implement entry modes, PC selection, Firebase synchronization, permissions, saving, and reconnecting.

Verify that clients receive the correct controls and retain character identity and saved data after reconnecting.

### 2. Playable tabletop

Implement repository asset catalogs, scenes, `.dd2vtt` import, grid and snapping, tokens, props, hiding, pings, and dice.

The first playable milestone passes when a GM and two players can join, load an imported map, move their respective tokens, roll dice, switch scenes, and reload without losing saved state. Confirm that players can move only their own tokens through the player interface.

### 3. Visibility

Implement walls, doors, lighting, manual fog, individual vision, exploration memory, and player-view preview.

Verify different player views, wall obstruction, door transitions, light changes, fog priority, hidden objects, and persisted exploration.

### 4. Characters and combat

Implement both sheet editions, inventory, initiative, conditions, and overrides.

Verify character persistence across scenes and reloads, ownership-based editing, sheet rolls, initiative progression, and GM overrides.

### 5. Campaign tools and polish

Implement journals, soundboard, backups, and interface polish.

Verify selective journal sharing, shared audio playback, local volume, campaign export/import, and the integrated GM/player session flow.

## Working agreement

The plan has been approved for direction. The current instruction is to save it to `plan.md`; application implementation will begin when requested.
