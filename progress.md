# GeezVTT progress

Updated: 2026-11-23

## Token art, object controls, vision, item rules and campaign tools saved - 2026-11-23

- Adds character-name token portrait lookup with a catalog-backed Image name override, preserved through scene imports/exports and shared state. Portraits appear in Initiative and on 2D/3D token bases. Fixes the reported missing 3D miniatures by removing portrait-load behavior that hid them; increments the renderer import version.
- Adds GM Resize actions for tokens, props, portals, lights, floors, walls, doors and windows. Segment resizing preserves the midpoint; door resizing adjusts adjoining wall openings. Retains door/compartment Lock and Unlock and extends compartment controls to props containing inventory.
- Reads individual sight and darkvision from Firebase senses, with wall/closed-door obstruction and illumination. Filters GM-hidden objects from player views. Dynamic player sight takes precedence over manual fog cover/reveal; the GM retains the manual overlay.
- Adds per-character 2014/2024 rules selection, defaulting to 2024. VTT consumables use GM-mediated conditional world saves for inventory, target HP/effects, turn costs and retry receipts together. Potions spend a bonus action in 2024 and an action in 2014; outside initiative action tracking is off. Standalone sheets direct combat consumable use to the VTT.
- Adds automatic healing potion HP changes, configurable immediate healing/damage consumables, recognized timed potion effects and descriptions, and inventory quantity spending. Damage spends temporary HP first. Throw picks a map destination, checks weight/strength, range and obstruction, spends an attack during initiative, and leaves one recoverable item in a small compartment.
- Applies requested variant encumbrance penalties to movement and physical rolls, including automatic disadvantage selection. Accounts for size and recognized Powerful Build traits; blocks movement above capacity and rejects known-weight capacity-exceeding additions/transfers/taking. Unknown weights remain flagged.
- Adds standard-width Journal, Handouts and Soundboard windows. Journals are stored per linked PC with conditional saves and unsaved-note protection. GM handouts send image/text files up to 1 MB to selected linked PC tokens. Soundboard shares ambience/SFX/music playback state and position with local volume and audio unlocking. Adds empty repository audio catalogs and extends update_indexes.py to rebuild them; no audio tracks were supplied.
- Suppresses the native browser context menu across the VTT page without stopping app right-click event handlers.
- Adds unrun regression cases for images, resizing and door openings, sight/darkvision, encumbrance, consumables, throwing, conditional item transactions and audio catalogs; updates affected existing assertions and to-do.md.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, updater execution or other application validation commands were run. Firebase character records were read only to identify the existing senses fields; no live data was changed. The user reported missing 3D tokens after the earlier changes; the code fix and native-context-menu suppression await user verification.

Outstanding: verify all new menus/windows in 2D/3D/First Person, portrait loading alongside miniatures, object resize/lock persistence, per-player visibility, item HP/effect/quantity/turn transactions and conflict/retry behavior, carrying totals and penalties, journal conflicts, handout recipients, audio unlock/reconnect/synchronization, audio index generation, and browser context-menu suppression. Earlier verification backlogs remain applicable.

Known limits: special potion mechanics such as charm targets, aerial movement, mind reading, attack-triggered expiration, damage-type resolution and extra Haste actions require GM adjudication. Timed effects use existing game-time controls. Throw hit/save/damage resolution is manual; carrying capacity is the table rule for maximum throwable weight. Missing weights prevent complete capacity enforcement. Audio assets must be supplied. Existing trusted-group Firebase access governs journals, handouts, shared state and hidden data; UI filtering is not server authorization.

Save, commit and push requested to origin/main. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit.

## Token portraits, index updater, and TODO corrections saved - 2026-11-23

- Adds the supplied token PNG images and existing filename catalog at `token/index.json`. Initiative portrait paths now lowercase character names and replace whitespace with underscores to match files such as `liora.png` and `adult_black_dragon.png`; missing portraits retain the letter fallback.
- Adds `update_token_index.py`: run `python update_token_index.py` to rebuild the catalog as a sorted list of image filenames, including new files and removing deleted ones. Uses an atomic file replacement and ignores directories and non-image files. Adds an unrun regression case.
- Corrects stale TODO entries for repository battlemap/scene catalogs, shared distance measurement, shared pings, and GM scene loading synchronized to players. Records remaining grid adjustment and token-art work separately.

Verification is left to the user. No tests, browser checks, visual inspections, or application validation commands were run. Outstanding: run the index updater and its regression test, confirm portrait filename matching and fallback in Initiative, and reconcile the remaining older TODO sections against the implemented features. Token art is currently used by Initiative; a token image picker and map-token portrait rendering remain outstanding.

Save, commit, and push requested to origin/main. Exclude the unrelated `scene/blackpearl-whole.geezvtt` change and the ZIP archive inside `token`.

## Traps and object triggers saved - 2026-11-23

- Adds Tripwire, Pressure plate, Lever, and Button to the prop palettes, with SVG icons and code-built 3D models. Tripwires draw as segment chains like walls, finished with Enter; pressure plates stay one cell. Levers/buttons show toggle state and plates reflect PC occupancy.
- Adds Object > Trigger > Connect to, map target picking, Connect, and a standard-width Trigger window. Supports collision (player enters/crosses) and interaction events, multiple connections, editing/deleting connections, explicit open/close/lock/unlock and toggle states, fixed/dice damage to the activating PC or connected token, and movement of a connected prop/token to a picked destination.
- Runs player interactions and trigger effects through the existing GM session. Adds nearby player lever/button and door interaction, chest open/close hooks, and confirmed movement collision hooks. Initiative collision follows the reachable cell path. Chained movement retains the moved PC as the activating damage target and limits each connection to one firing per activation chain.
- Preserves connections and stable object IDs through map/scene exports, shared live state, and editor history. Adds wall actions/picking and updates the renderer import version. Linked PC damage uses conditional character writes, spends temporary HP first, and reports failures; other token HP updates remain scene-local.
- Updates to-do.md and adds unrun trigger regression cases for prop imports/geometry, connection validation, entry/crossing/path behavior, state changes, damage targets, temporary HP, and bounded chained movement.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run for this work.

Outstanding work: exercise drawing and target/destination picking in 2D/3D/First Person; all connection settings and editing/deletion; GM/player interactions, proximity and ownership restrictions; collision entry, crossing, repeat entry, and initiative paths; state effects, fixed/dice damage, temporary HP and specific targets; movement chains; scene export/import, reload and live synchronization; Firebase conflicts, denied writes, timeouts, and scene changes during damage saves. Earlier verification items remain outstanding.

Known limits: an online GM session resolves player triggers. Movement effects relocate directly without wall blocking. Each connection fires at most once per activation chain. Character damage and scene effects save separately; failed damage requires GM resolution and checking HP before retrying. Existing trusted-group roles and Firebase rules still govern access.

Save, commit, and push requested to origin/main. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit.

## Consumable targets, compartments, tier loot, and carrying limits saved - 2026-11-23

- Adds Item > Use > target PC > Confirm use for configured consuming effects in both the VTT and standalone sheet. Conditionally saves source item/charge spending and recipient effect state together. Target copies retain duration and modifiers without allowing free reactivation after ending. Existing ownership checks apply to the source character.
- Extends crate/chest inventories with quantities, weights, and preserved item metadata. Right click > Compartment > Contents selects adventuring tier 1–4 and adds random coins, gear, and tier-matched magic items. Compartment > Open provides Add SRD Item and Add Custom Item controls in the existing standard-width floating window.
- Clicking a compartment item transfers one unit; Take All transfers all remaining contents to the selected controlled PC. Coins credit the corresponding coin-purse denominations. Conditional world writes save bag additions, compartment removal, and retry receipts together. Transfers recheck shared contents and proximity; the GM drains pending scene saves and defers publishing during the transfer to avoid restoring stale contents. Player sessions receive success/error responses.
- Adds SRD/custom item weights, editable weight overrides, stack and coin totals, current-STR and size-based carrying capacity, missing-weight warnings, and over-capacity status. Keeps weight metadata through compartment taking and existing bag transfers. Limits are displayed; automatic encumbrance penalties and hard enforcement are not added.
- Reconciles the plan with the implemented JavaScript/SVG/Three.js architecture, shared-tabletop work, light-through-fog behavior, and portable scenes/weather/exterior floors. Updates the requested-additions checklist and records outstanding features.
- Adds unrun regression cases for weight calculations and validation, stack metadata, single/all taking, coin credits, loot tier boundaries, targeted effects, conditional conflicts, request receipts, and ownership restrictions.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. The user reported that choosing Tier 1 populated a chest with 28 copper, 45 silver, and 11 gold and accepted the current loot ranges as good enough for now. This confirms that reported interaction only; it does not verify inventory transfers or the remaining flows.

Outstanding work: exercise Use/target/confirm/cancel and concurrent source/target changes; check effect expiration and preventing free reactivation; take individual units and Take All across GM/player sessions; confirm coin-purse credits, metadata and quantity preservation, proximity/ownership restrictions, retry receipts, scene changes, Firebase errors, and live synchronization; exercise SRD/custom additions, all loot tiers, weight overrides, missing weights, size/current-STR changes, and carrying totals. Earlier verification items remain outstanding. Traps/triggers, instant healing/damage consumables, non-PC consumable targets, automatic potion effects, effect configuration following transferred items, special carrying traits, and optional encumbrance penalties remain unimplemented.

Known limits: loot uses app-defined bounded SRD pools and coin ranges rather than official DMG hoard tables; generating loot adds to existing contents. Magic/custom items without known weights remain explicitly unknown. Compartment taking requires an online GM session and Firebase write access at `v2/worlds/gaia`; targeted consumable saves require entities-collection write access. Existing trusted-group roles and Firebase rules still govern access. The GM URL remains `?gm=jonny`; `?gm=1` uses player mode.

Save, commit, and push requested to origin/main. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit.

## Default 3D starting view — 2026-11-23

- Opens 3D automatically when the first map loads, using the existing toggle and 2D fallback if 3D initialization fails.
- New scenes preserve the selected view instead of forcing 2D. Manual switching remains available.
- Verification: left to the user. No tests, browser checks, visual inspections, or validation commands were run.
- Outstanding: user verification of initial 3D loading, manual switching, new scenes, and fallback behavior.
- Unrelated existing workspace changes are excluded from this commit.

## Initiative five-tile layout and immediate miniature updates — 2026-11-23

- Replaced Initiative name rows with exactly five square tiles: four turn slots and Next Turn. Turn tiles show the first letter of the name, or `token/<exact character name>.png` when that image loads. Missing pictures retain the letter. Empty turn slots remain visible, the current turn is highlighted, and full names appear on hover and in accessible labels.
- Reused the Controls grid, square styling, compact panel width, and existing resizing; five tiles fit across at the default width and wrap as the window narrows. Removed the per-tile removal buttons. Next Turn stays visible for all roles but is enabled only for the GM with at least two entries.
- Changing Edit Token > Icon now updates the placed token and 3D miniature immediately, without Apply or Firebase stat saves.
- Verification: left to the user. No tests, browser checks, visual inspections, or validation commands were run.
- Outstanding: user verification of tile sizing/resizing, turn progression, image fallback/loading, and immediate 3D selection changes. No `token` directory currently exists in the repository; pictures must be supplied using the filename convention above.
- Unrelated existing workspace changes are excluded from this commit.

## Token miniatures and Initiative update — 2026-11-23

- Added code-built 3D token miniatures with shared geometry/materials, including a bard with a feathered hat, cape, boots, and lute. Miniatures scale with token size and retain token picking, movement, context menus, and PC health labels.
- Added Token > Right Click > Edit Token > Icon: Generic, Fighter, Hunter, Druid, Wizard, Sorcerer, Bard, Monk, Rogue, Barbarian, Cleric, Paladin, Ranger, Warlock, and Artificer. Selections use class symbols in 2D and class equipment/silhouettes in 3D. Missing or invalid selections use Generic.
- Icon selections are per placed token, retained in map exports/imports and local token updates, including edits to linked PCs. Character stat synchronization preserves each token's icon.
- Initiative now shows readable name rows instead of cramped square score tiles, with the current turn highlighted and GM removal/Next Turn controls retained. It uses the compact Controls window width and existing window resizing.
- Removed the visible map navigation help overlay and its references in the view toggle/player controls.
- Verification: left to the user as instructed. No tests, browser checks, visual inspections, or validation commands were run for these changes.
- Outstanding: user verification of miniature appearance, class selection, token interactions, save/reload behavior, PC edits, and Initiative readability. Class miniatures are static stylized variants; no animation was added.
- Unrelated existing workspace changes are excluded from this commit.

## Current implementation

The initial map importer is implemented in the root `index.html`. Open it in a modern browser and choose a local `.dd2vtt` file.

- Parses DD2VTT JSON and displays its embedded base64 map image as a flat tabletop floor, fitted to the available space.
- Supports PNG, JPEG, WebP, and GIF image signatures, including raw base64 and supported image data URLs.
- Draws imported `line_of_sight` walls as cyan polylines.
- Draws imported `lights` as colored range circles and source markers. Reads Dungeondraft AARRGGBB colors. Light intensity is included in hover text; this is a visualization of light data, without illumination or shadow calculations.
- Draws imported `portals` as doors: orange for closed doors and dashed green for open doors, using their imported state.
- Provides independent visibility checkboxes and imported counts for walls, lights, and doors. These controls become available after a successful import.
- Uses a shared SVG coordinate system for the map image and overlays, accounting for map size and origin so they resize together.
- Shows import status and errors. Failed imports preserve the previous map; newer selections take priority over earlier imports still loading.
- Adds a compact dice roller below the tabletop: d4, d6, d8, d10, d12, d20, and d100, quantity, signed modifier, and single-d20 advantage/disadvantage. Limits batches to 12 physical dice (six percentile pairs).
- Integrates the supplied `js/dice3d.js` as a transparent, non-interactive overlay over the map. Loads its compatible Three.js r128 and Cannon dependencies only on the first animated roll; removes the unused, incompatible Three.js 0.170.0 placeholder.
- Calculates roll results independently in `js/dice-roll.js` with unbiased cryptographic random sampling. Records ten recent local rolls, including dropped dice and natural 1/20 highlighting. `js/dice-roller.js` handles the controls, optional 3D animation, clearing the tray, and fallback text when rendering fails. New rolls replace the previous tray contents; clearing preserves history.
- Dice rolls and history are local to the current page session, without Firebase synchronization or persistence. Serve the project over HTTP (for example, GitHub Pages) so the browser can load its JavaScript modules.
- Adds a 2D/3D view toggle after map import, with a textured map floor, walls and doors extruded two grid units (10 feet), and open doors swung 90 degrees. Uses grid-space dimensions and map origin rather than the supplied `view3d.js` fixed 40-pixel scale. The supplied file is preserved; standalone `js/map-view-3d.js` and `js/map-view-toggle.js` adapt its camera and extrusion approach without its missing application dependencies.
- Provides drag-to-orbit, right-drag-to-pan, wheel zoom, touch controls, and Fit map. Existing walls, doors, and light-range checkboxes apply to both views. Keeps the camera when toggling views; fits newly imported maps, disposes replaced geometry/textures, pauses rendering in 2D, and falls back to 2D if initialization fails. Modern Three.js is module-scoped, separate from the dice renderer's global r128.
- Adds 2D object editing in `js/map-editor.js`, with pure geometry helpers in `js/map-editor-model.js`. Select by click or box, Shift to extend/toggle selection, and drag selected objects to move them. Walls and doors are split into individually editable segments. Hidden layers cannot be selected or erased; painting reveals the active layer.
- Erase and Replace work on individual segments/light sources or a dragged box. Replace applies wood, stone, cobble, brick, or metal material to walls/doors, open/closed state to doors, and color/range/intensity to lights. Materials use color in 2D and color/roughness/metalness in 3D; textures are not included.
- Paint walls/doors by clicking successive points and pressing Enter to commit the chain. Escape cancels; Backspace removes the last point. Light Paint places a source per click. Optional grid snapping applies to placement and movement.
- Paint Bucket is disabled for walls. For lights/doors, clicking flood-fills connected grid-cell centers with objects at the chosen spacing. Wall and closed-door segments block traversal; open doors allow it. Doors are placed horizontally. Fills use a grid approximation, skip occupied centers, and refuse fills above 2,000 objects before modifying the map.
- Adds up to 50 Undo/Redo snapshots, selection property application/deletion, and DD2VTT export. Export preserves the embedded image, map origin, imported door/light metadata, and stores material names in a `geezvtt_editor` extension. Changes update both renderers without resetting the 3D camera; editing controls are disabled in 3D. Changes remain local until exported.

## Existing project inputs

- `plan.md` contains the approved broader product and architecture plan.
- `js/firebase-config.js` contains the existing shared GeezSheets Firebase configuration. The importer does not yet load or use Firebase.
- Supplied map files: `battlemap/camp.dd2vtt`, `battlemap/chapel_dungeon.dd2vtt`, `battlemap/forestroad.dd2vtt`, and `battlemap/prison_00.dd2vtt`.
- `battlemap/index.json` exists, but the importer currently uses local file selection rather than the catalog.

## Verification completed

JavaScript parsing and image-source extraction checks passed for all four supplied maps. Overlay checks matched the imported geometry counts:

| Map | Wall polylines | Doors | Lights |
| --- | ---: | ---: | ---: |
| camp | 0 | 0 | 13 |
| chapel_dungeon | 289 | 19 | 53 |
| forestroad | 0 | 0 | 0 |
| prison_00 | 25 | 6 | 6 |

Additional checks passed for nonzero map origins, open-door styling, light color conversion and range, invalid image rejection, and malformed optional geometry handling. These were Node-based checks with DOM stubs, not browser rendering tests.

Browser rendering, image decoding, checkbox interaction, and responsive alignment still need visual verification.

Dice rule checks passed for multi-die totals, signed modifiers, advantage/disadvantage, ties, critical results, percentile limits, invalid inputs, and random result ranges. Inline JavaScript and all three dice modules passed Node syntax checks; HTML IDs are unique. No browser rendering test was available in this session, so 3D appearance, CDN loading, and responsive controls still need browser verification.

3D checks passed for module/inline syntax, import-map JSON, wall height/centering, open-door hinge transforms, zero-length segment handling, nonzero origins, and wall segments from all four supplied maps. Controller checks with DOM stubs passed for lazy creation, importing a new map while in 3D, toggling back/reopening, and Fit map. Actual WebGL rendering and camera interaction still require browser verification; no browser automation was available.

## Scope remaining

Editor verification: `node --test tests/map-editor.test.mjs` passes four geometry/fill checks. `node tests/map-editor-browser.mjs` passes actual headless Edge interaction checks for all four map imports, chain creation/commit/cancel, box selection, group movement, material replacement, single/box erasing, Undo/Redo, enclosed bucket fills and duplicate avoidance, light properties, door states, export/re-import, nonzero origins, invalid optional objects, light alpha/intensity, and preservation of imported metadata. This browser script uses Node built-ins, a temporary browser profile, and a loopback server; set `BROWSER_PATH` to use a different Chromium binary. All changed JavaScript passed syntax checks. Actual updated 3D materials still need visual verification.

This is an incremental, local map-import and editing prototype. It has no automatic persistence, multiplayer synchronization, Firebase integration, 2D pan/zoom, or calculated player visibility yet. Export/re-import retains local edits. The broader features in `plan.md` remain to be implemented as requested.

## Lighting work saved — 2026-11-22

Implementation is saved locally in `js/map-view-3d.js` and `index.html`; browser verification remains unfinished.

- Replaces 3D light-range circles with real colored point lights using imported or edited range, intensity, and alpha. Zero-strength lights are omitted; imported `shadows: false` is respected.
- Makes the textured floor receive lighting and shadows, and wall/door slabs cast and receive shadows. Open doors retain their existing hinge transform.
- Enables soft shadow filtering and ACES tone mapping. Uses dim ambient/daylight fill when point lights exist and brighter daylight for maps without active sources. The directional light's shadow camera fits the map dimensions.
- Limits point-light shadows to the eight strongest eligible lights, with 512-pixel shadow faces; additional lights illuminate without occlusion and can shine through walls. The directional light also casts shadows, with a 2048-pixel map. The Lights checkbox tooltip explains the eight-light limit.
- Caches shadow maps during camera movement, requests updates on map edits and layer changes, invalidates rendering after map replacement, and disposes point-light shadow resources on rebuild and directional shadow resources on teardown.
- Keeps 2D light-range overlays and existing editing/export formats. Lighting does not implement player visibility or fog. Supplied map images contain baked lighting, which remains part of the image beneath the new illumination.

Checks completed for this lighting change: `node --check js/map-view-3d.js` passed; `node --test tests/map-editor.test.mjs` passed all four existing geometry/fill tests. Those tests do not verify illumination or shadows.

Next: add and run browser/WebGL checks for actual illumination, wall occlusion, opening/closing doors, layer visibility, edited light properties, repeated map replacement/resource disposal, and the eight-light shadow limit. Check the supplied maps visually and measure performance on a large map. Browser lighting verification had not started when the user requested this progress save.

No deployment or commit has been performed. Existing unrelated working-tree changes were left in place.

## UI work saved — 2026-11-22

This section supersedes the earlier UI descriptions and verification status for the changed controls.

- Adds a Windows-style File / Edit / View / Dice menu bar. File imports a DD2VTT map and saves the edited map as a downloaded DD2VTT file. View switches between 2D and 3D, toggles a grid overlay in either view, and retains Fit map for 3D. Dice opens the existing dice roller.
- Edit > Walls, Lights, or Doors opens a shared floating editor with the selected object type. Drag its title bar to move it, or focus the title bar and use arrow keys. The window stays within the viewport and closes with ×. Closing stops map editing and clears unfinished gestures and selections; saved edits remain.
- Replaces the tool dropdown with Select, Erase, Paint, Bucket, and Replace buttons. Walls and Doors show material swatches for wood, stone, cobble, brick, and metal. Lights show color, range, and intensity controls. Existing selection, snapping, Undo/Redo, and export behavior remain. Bucket remains unavailable for walls.
- Removes the Walls, Lights, and Doors visibility checkboxes and counts. All three object layers remain visible in both views.
- Adds mouse-centered scroll zoom to the 2D SVG map, bounded between 0.05× and 4× the original view-box width. Importing a map resets its view. Zooming cancels unfinished editing gestures. 2D panning is not implemented.
- Adds repository instructions in AGENTS.md leaving verification to the user.

No tests, browser checks, visual inspections, or other validation commands were run for this UI work. Verification is left to the user. Existing browser tests may need updates for the floating editor and removed visibility controls.

## Floating windows and map controls saved — 2026-11-22

This section supersedes earlier descriptions of window layout, material swatches, and 2D panning.

- Tools, Walls, Lights, Doors, and Dice use equal-width floating windows. Nearby edges snap within 12 pixels. Touching windows move together, including connected chains; Shift-drag detaches one window and disables snapping for that drag. Arrow keys move connected windows together, with Shift moving only the focused window. Title bars match the top menu's text size and spacing.
- Wall and door palettes independently show the four most recent materials and a dropdown for the remaining choices. Choosing a material promotes it to the first swatch. Recent choices reset on page reload.
- Wall painting always snaps to grid intersections. Holding Shift also allows grid-line midpoints, excluding cell centers. Preview and placement share the same snapping behavior.
- Middle-click dragging pans the 2D map without changing zoom. Pointer capture keeps the drag active outside the map; releasing or canceling ends panning.
- Updated browser regression coverage for wall snapping, material recency, window widths/snapping/group movement/detachment, and 2D panning.

Implementation was committed as `ce43138` (Improve map snapping, panning, and floating window controls) and pushed to `origin/main`. The unrelated README deletion was left unstaged. This progress entry and the instruction to update progress on future save requests were added afterward.

No tests, browser checks, visual inspections, or other validation commands were run for these changes. Verification is left to the user; exercising the updated browser coverage and checking the new interactions remain outstanding.

## Tokens and standardized controls saved - 2026-11-22

This section supersedes earlier token and mouse-control descriptions.

- Edit > Tokens opens the shared Tools window and a floating token palette with Firebase NPCs or Blank Token. Reads current GeezSheets NPC entities and older NPC records, avoiding duplicates linked by source references. Firebase errors appear in the palette; Blank Token remains available.
- Tokens use Select, Erase, Paint, Bucket, and Replace, including box selection, group movement, grid snapping, Apply/Delete, and the shared Undo/Redo history. Bucket fills reuse wall/closed-door barriers, spacing, duplicate-center avoidance, and the 2,000-object limit.
- Right-click a token to edit its name, size in grid squares, and HP. These property changes also participate in Undo/Redo. Tokens display in both 2D and 3D and survive Save Map/export and re-import through the DD2VTT `geezvtt_editor.tokens` extension.
- Token creation and movement use the 2D editor. NPC records are read only; token edits remain local until exported and do not update Firebase NPCs or synchronize a shared scene.
- Mouse controls are middle-drag to pan and scroll to zoom in both views, plus right-drag to orbit in 3D. Left-drag no longer orbits the 3D camera. Right-click token editing waits for release and ignores drags, preserving orbit gestures. Touch camera controls remain available.
- Select, Erase, and Replace use unclamped coordinates and accept gestures outside the map image, allowing imported Dungeondraft lights beyond its bounds to be selected or deleted. Paint and Bucket still require an on-map starting point. Pan or zoom out to reach outside objects.
- Added token data and right-click gesture tests; expanded browser coverage for shared token tools, property edits, Undo/Redo, exports, right-clicking with different tools, and editing outside map bounds. Added a token box-selection geometry case.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run for this work. Outstanding verification includes Firebase access and NPC loading, token tools and export/re-import, stationary right-click versus orbit dragging, 2D/3D camera controls, and deleting outside-map lights. Earlier lighting and floating-window verification remains outstanding as recorded above.

Save requested with commit and push to `origin/main`. Include the pending save-workflow instruction in AGENTS.md and previous progress notes. Leave the unrelated README.md deletion unstaged.

## Floors and compact palettes saved - 2026-11-22

This section supersedes earlier palette layouts and floor-editing descriptions.

- Adds Edit > Floors with its own floating material palette and the shared Select, Erase, Paint, Bucket, Replace, Apply/Delete, and Undo/Redo tools. Floors use one-square tiles and can be placed or moved outside the imported DD2VTT bounds, including negative coordinates. Other layers retain their existing placement bounds.
- Floors coexist with the embedded map image at the same ground elevation in 3D. The image takes precedence where they overlap; drawn floors remain visible beyond its edges. The imported image is not moved or resized.
- Saves floor coordinates and materials in `geezvtt_editor.floors` and restores them on import. Floor fills use one-square spacing, respect walls and closed doors, skip occupied centers, and retain the 2,000-object limit. Their finite fill area includes the image, existing floors, and clicked tile.
- Extends the 2D grid around the current view. The 3D grid, Fit map, and directional shadow bounds include exterior floor tiles.
- Removes Floors tips and Tokens tool instructions, NPC loading chatter, and successful loaded-count text. NPC loading failures and incomplete-list messages remain visible. Tokens uses a compact inline selector; Lights places Color, Range, and Intensity on one row in a wider window.
- Adds regression cases for floor box selection outside the image and negative-coordinate bucket bounds with wall barriers and fill limits.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: verify floor tools and history, exterior and negative-coordinate drawing, fill bounds, export/re-import, image/floor coexistence in both views, expanded grids and 3D framing, and compact palettes at narrow window sizes. Existing verification items above remain outstanding.

Save requested with commit and push to `origin/main`. Leave the unrelated README.md deletion unstaged.

## Floor layering and 3D presentation saved - 2026-11-22

This section supersedes the earlier image-over-floor layering description.

- Drawn floors render above the embedded DD2VTT image and below the grid in 2D.
- Raises 3D floor tiles to y = -0.001, above the image at y = -0.005 and below the grid at y = 0.
- Includes pending 3D presentation changes removing wall/door edge outlines and reducing ambient light to 0.03 and directional light to zero when active point lights exist.

Verification is left to the user. No tests, browser checks, visual inspections, or other application validation commands were run. Outstanding work: verify painted floors cover the image in both views, grid visibility, and 3D lighting and wall/door appearance. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt out of the commit.
# Portable scenes saved - 2026-11-22

- Adds File > Save Scene (.geezvtt) and Open Scene, plus a scene name field and visible unsaved/download status.
- Scene files contain a versioned GeezVTT envelope with the scene name, original DD2VTT source name, embedded map image, and edited walls, doors, lights, floor tiles, materials, and tokens. Loading reuses the existing map import and editor restoration path. DD2VTT import and Save Map remain available.
- Shares map serialization between scene downloads and DD2VTT exports. Unsupported scene versions and invalid scene metadata are rejected before replacing the loaded map.
- Warns before replacing unsaved prep or leaving the page. Saves download a portable file; there is no automatic browser storage or cloud scene library.
- Adds browser coverage for scene export/re-import, retained prep data, unsupported versions, and canceled replacement of unsaved changes.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: verify scene naming, downloaded files, scene round trips with all edited layers, DD2VTT compatibility, invalid-file handling, and unsaved-change prompts. Confirm the download completes; starting a download clears the unsaved indicator. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt out of the commit.

## Fog of war, weather, and time of day saved - 2026-11-22

- Adds View > Environment as a draggable floating window available in both views. Includes Cover map, Reveal map, and manual reveal/hide brushes in 2D. Fog appears in both 2D and 3D and covers the imported map area; exterior painted floors are outside its bounds. Large maps use larger fog cells to bound geometry costs.
- Active map lights temporarily reveal fog within their range. Walls and closed doors block this reveal; opening doors or editing/moving/removing lights updates fog in both views. Disabling lights restores fog unless an area was manually revealed. Light reveal uses fog-cell centers, so boundaries follow cell resolution.
- Adds clear/rain/snow weather overlays with reduced-motion support, plus Original lighting, Day, Dawn, Dusk, and Night. Time presets change 3D lighting and apply a tint in 2D. Ambient/time-of-day light does not reveal fog.
- Persists environment and manual fog settings in the map editor extension for both DD2VTT exports and portable scenes. Environment changes mark scenes unsaved. Existing maps default to original lighting, clear weather, and no fog.
- Adds unrun regression coverage for imported settings, fog cells and bounds, light reveal, disabled lights, retained manual reveals, and wall/door blocking.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: exercise cover/reveal and brushes in both views, lights and wall/door blocking, light removal and manual reveal persistence, weather and reduced-motion behavior, time presets, and scene/map export round trips. Fog has no automatic token vision and is not a server-side access boundary. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt out of the commit.

## Scene floors saved - 2026-11-23

- Adds the Scene > Floor > Map hierarchy. Portable scene format v2 stores all floors and the selected floor; existing v1 scenes open with their map on Floor 1. Older app versions cannot open v2 saves.
- Floor Up/Down controls switch between existing floors and create a blank floor at either end. Blank floors inherit the current map dimensions, or start at 40 by 40 when no scene is open, allowing drawing without an imported map.
- Uses Floor 1, Floor 2, and higher numbers upward, and Floor -1, Floor -2, and lower numbers downward, skipping zero. Floor numbers persist independently of custom floor names. Previously generated Upper Floor/Lower Floor names become numbered names when loaded.
- Import Map applies a DD2VTT to the selected floor, replacing that floor's map and edits while preserving the scene name and other floors. The first import creates the scene. Removed the separate Add Floor from Map workflow.
- Includes a floor selector and Scene menu actions to rename or remove floors. Switching preserves each floor's map edits, tokens, fog, and environment; saving a scene includes all floors. Save Map exports the selected floor only.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: exercise positive and negative floor numbering, blank-floor drawing, importing onto selected floors, switching with edits, rename/remove behavior, v1 migration, v2 save/open round trips with every floor's tokens and environment, and failure handling for invalid imports. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of the commit.

## Object menus, procedural props, and compact windows saved - 2026-11-23

- Adds portal right-click menus in 2D and 3D with Hide/Show, Delete, and Change Icon. Hidden endpoints remain faintly visible with the 2D Portals tools open so they can be restored. Icon and visibility settings persist with map and scene saves and participate in Undo/Redo.
- Adds door right-click menus in both views with Open/Close, Lock/Unlock, and Delete. Locking closes an open door; locked doors cannot be opened through the menu or Apply until unlocked. Lock state persists in the DD2VTT editor extension. Windows retain their separate behavior.
- Adds Edit > Props with crate, stairs, ladder, chest, bones, torch, brazier, table, chair, and cobweb. Uses code-drawn SVG icons in 2D and procedural Three.js geometry in 3D, sharing geometry and materials within each map build without external assets.
- Props support Paint, selection and box selection, movement, size, rotation, Replace/Apply, deletion, and Undo/Redo. Right-click in either view to hide/show, rotate, change object type, or delete. Hidden props remain accessible through the open 2D Props tools. Map exports and portable scenes preserve prop identities, transforms, types, and visibility. 3D framing includes exterior props.
- Props are decorative: stairs and ladders do not replace paired portal travel, and torch/brazier flames do not add map lighting or fog reveal.
- Makes Lights use the standard floating-window width with wrapping controls. Removes explanatory paragraphs from floating windows and shortens portal/fog status text. Records the standard width and no-description rule for future floating windows in AGENTS.md.
- Adds focused prop data round-trip, invalid-data, rotated picking, and box-selection tests; these have not been run.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: exercise portal and door menus in both views, locked-door behavior, hidden-object restoration, menu keyboard controls, prop placement/movement/size/rotation/replacement and history, all ten icons and 3D models, map/scene round trips across floors, and standard window widths. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of the commit.

## Scene environment and windows saved - 2026-11-23

- Weather and time of day now apply across every map in a scene, including added and replaced floor maps. Scene saves persist these shared settings; fog remains per map. Older scenes initialize shared weather and time from their selected map.
- Adds Door and Window types under Edit > Doors, alongside the door's open/closed state. Unmarked open DD2VTT portals import as windows and closed portals as doors. Explicit portal types persist in map exports and scene saves so an opened door remains a door on reimport.
- Windows use a distinct blue dashed appearance in 2D and transparent panes without opaque shadows in 3D. Windows transmit map light for fog reveal, block token dragging with token-size clearance, and enclose bucket fills.
- Adds unrun regression coverage for portal classification, light transmission, bucket barriers, and token movement across windows and near endpoints. Automatic token vision is still not implemented.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: verify scene-wide environment settings when switching, adding, and replacing maps; scene and map export/reimport; Door/Window editing and history; window appearance and lighting in both views; and token movement near windows. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of the commit.

## Paired portals and procedural materials saved - 2026-11-23

- Adds Edit > Portals with a matching draggable, snapping floating window and the shared Tools window. Opening Portals activates Paint: click once for the first node and again for its partner, including switching floors between clicks. Provides placement previews, Select, group movement, Erase/Delete, and local Undo/Redo. Bucket, Replace, and Apply are disabled for portals because endpoints have no material settings.
- Stores endpoint and pair identities in geezvtt_editor.portals for map exports and portable scenes. Pair resolution works independently of floor names and order, providing the connection model for future stairs. Unpaired nodes display distinctly; selecting one resumes pairing, and New pair starts another connection.
- Use selected portal moves tokens whose centers stand within half a square of the endpoint to its partner, switching floors when needed. Destinations outside map bounds cannot receive tokens. Cross-floor travel resets local undo history; deleting a node or floor leaves its partner unpaired.
- Adds deterministic, cached canvas textures for wood grain/planks, stone blocks/cracks, cobbles, brickwork, and brushed metal plates/rivets. Uses the generated textures in material swatches, SVG floor fills and wall/door strokes, and 3D floor/wall/door materials with bump detail and material-specific roughness. Scales wall texture coordinates by segment dimensions. Imported walls and doors without a material use stone and wood respectively; windows retain their transparent presentation.
- Adds unrun regression cases for portal import filtering, persistent pair identities, cross-floor destination resolution, incomplete/ambiguous pairs, and exterior box selection.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: exercise two-click pairing on the same floor and across floors, shared portal tools and history, unpaired-node repair and deletion, token travel and failed destination loading, map/scene round trips, and all five textures on palettes and surfaces in both views. Stairs presentation is not implemented. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of the commit.

## Light and portal prop appearances, and 3D grid saved - 2026-11-23

- Right-click lights and portals to choose any of the ten prop appearances. The picker includes SVG previews and retains the original portal symbols and default light option.
- Uses SVG prop markers in 2D and the existing shared procedural models in 3D. Appearance changes preserve light settings, fog reveal, portal identity, pairing, and travel behavior, and participate in Undo/Redo.
- Adds clickable default light markers and light context menus in 3D. Prop-shaped light and portal models open their original object's menu rather than the scenery menu. Picking, box selection, and 3D framing include their prop footprints.
- Persists light appearances through the geezvtt_icon light metadata and portal appearances through geezvtt_editor.portals for map and scene round trips. Invalid prop icon names fall back to the original appearance; legacy portal symbols remain supported.
- Raises the 3D grid slightly above ground and strengthens its polygon depth offset so the image's depth offset and painted floors do not cover grid lines. Keeps the existing Grid toggle and depth occlusion by other objects.
- Adds unrun regression cases for prop appearance validation, preserved portal identity and icon metadata, legacy icons, invalid icon fallback, and light/portal box selection.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: exercise all light and portal appearance choices in both views, default restoration, right-click and keyboard menus, selection and movement, Undo/Redo, map/scene round trips across floors, retained lighting/fog and portal travel, and 3D grid visibility above images and painted floors at different zoom levels with the Grid toggle. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of the commit.

## VTT controls saved - 2026-11-23

- Adds a compact floating VTT Controls menu using the standard editor-panel width, existing window dragging/snapping, and a collapse/expand button. View > VTT Controls brings it forward.
- Select opens/closes unlocked doors and drags tokens directly in 2D and 3D without opening map editing tools. Token drags preview their positions, snap movement to whole squares, remain within map bounds, and preserve the existing window collision restriction. Door changes and completed token moves use editor history and scene persistence.
- Measure snaps both endpoints to cell centers in both views. Adjacent horizontal or vertical cells measure exactly 5 ft; diagonals use straight-line distance. Measurements remain visible until the next interaction or Escape.
- Ping briefly highlights a map location in either view. Roll opens the existing dice roller.
- Map editing and fog brushes take input back from VTT tools. Selecting a VTT tool closes the map Tools window and turns the fog brush off. Cancelled gestures, map loads, and view changes clear temporary overlays and restore token previews.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: exercise collapse/expand and window dragging/snapping; door toggles and locked doors; token dragging, cancellation, bounds, window collisions, Undo/Redo, and scene/map round trips; cell-center measurements and diagonals; ping and dice access in both views; and switching between VTT tools, editing, and fog brushes. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of the commit.

## Dice and measurement cleanup saved - 2026-11-23

- Measurements now disappear three seconds after releasing the measuring drag in either view. Active drags remain visible, and existing cancellation and tool/map/view changes still clear the overlay immediately. This supersedes the previous persistent-measurement behavior.
- On-map dice and their result tags clear three seconds after the roll settles. Roll history remains available. Starting another roll, clearing the tray, or disabling animated dice cancels any pending cleanup timer so it cannot clear a later roll.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: confirm measurement expiry in both views, active measurement drags lasting longer than three seconds, dice cleanup after settling, retained history, and timer handling when clearing, rerolling, or disabling animation. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of the commit.

## PC token catalog, Firebase sync, and status displays saved - 2026-11-23

- Edit > Tokens includes current Firebase PCs alongside NPCs, preserving character ID links, legacy NPC deduplication, and deleted-record filtering.
- Linked PC tokens receive live Firebase updates to name, size, current/max HP, and AC. Applying PC token property edits saves changed name, size, and current HP fields to the canonical character record. Writes preserve unrelated character fields and report Firebase failures. Token positions remain local scene data.
- Adds a compact HP bar and current/max HP plus AC beneath PC tokens in both 2D and 3D. The bar changes color with remaining HP; missing max HP or AC displays a dash. PC status metadata survives map and scene export/import.
- Adds unrun regression coverage for PC catalog inclusion, deleted PCs, status values, HP bar clamping, missing stats, and saved PC metadata.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: confirm PC selection and placement; live Firebase changes and token property saves, including failures and reconnection; multiple tokens linked to one PC; status visibility in both views; and map/scene round trips and floor switching. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of the commit.

## File libraries and repository scripts saved - 2026-11-23

- Adds File > Load > Battlemap / Scene with a shared draggable library window, folder index listings, concise error states, and an optional local file picker. File > Import > Battlemap / Scene opens the existing file inputs directly.
- Refreshes battlemap/index.json to match available maps and adds scene/index.json listing the three supplied scene files. Library loads reuse the existing map and scene handling.
- Adds update_indexes.py to append newly discovered .dd2vtt and .geezvtt files to their respective indexes while retaining existing entries and labels. New entries omit bytes; deleted files remain listed.
- Adds push_repo.py to update indexes, record changed files and verification status in progress.md, commit all changes, and push the current branch to origin. It stops on Git failures and never force pushes. The script requires existing Git/GitHub authentication and stages all files when run.
- Adds unrun browser coverage for library loading and Python coverage for append-only indexing and stopping before push when commit fails.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: verify both library listings, hosted and local map/scene loading, inventory updates, and the repository push script. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.

## Local scene Save and Save As saved - 2026-11-23

- Adds File > Save Scene As and updates Save Scene to write directly to a chosen local .geezvtt file using browser file access. Save reuses the file handle during the current session; Save As opens a new picker.
- Local scene import and the library local-file option use the browser open picker when supported and remember the opened file for later saves. Loading another scene resets the file association; changing or replacing floors preserves it.
- Serializes the scene before asynchronous writes, clears unsaved status only after a completed local write with no newer edits, retains the previous handle when Save As fails or is cancelled, and reports write failures. Browsers without file access support retain downloads without marking edits saved.
- Adds unrun browser coverage for file-handle reuse, Save As, cancellation and permission failures, and updates existing scene export expectations to version 2 and the populated scene library.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: verify local open/save permissions, repeated Save, Save As, cancellation and failed writes, edits during a save, file association across floor and scene changes, download fallback, and pushing updated files from the repo scene folder. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.
## Thinner 3D doors saved - 2026-11-23

- Makes 3D door panels half as thick as walls (0.06 versus 0.12 world units), including open doors. Texture coordinates follow the panel thickness. Windows and the existing 2D presentation retain their current dimensions.

Verification is left to the user. No tests, browser checks, visual inspections, or other application validation commands were run. Outstanding work: confirm closed and open door appearance, textures, and selection in 3D. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.


## GM and player views saved - 2026-11-23

- Uses ?gm=jonny for the GM interface and the plain URL for players. Hides scene management, editing, environment controls, and object editing menus from players.
- Player tools are Select, Ping, Measure, Dice, and a 2D/3D toggle. Players select PC tokens and move with WASD outside initiative; movement respects map bounds, walls, windows, and closed doors. Space toggles a nearby unlocked door.
- Adds a GM Initiative active toggle that pauses player WASD movement. Preserves token IDs across imports and shared updates, and adds keyboard PC selection.
- Adds Firebase Realtime Database tabletop synchronization using REST writes and EventSource streams at v2/worlds/gaia/vtt. The GM publishes the shared scene and live geometry/environment/initiative state and processes player movement and door requests. Pings and dice results are shared; camera modes remain local.
- Player fog stays opaque except for existing light-based reveals, which respect walls and closed doors. GM fog is translucent in both views, and GM 3D picking ignores fog meshes.
- Adds unrun movement, initiative, door, and lighting/fog regression assertions in tests/player-actions.test.mjs.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: verify both URL modes and player restrictions; PC selection and WASD in both views; initiative pause; door proximity and locks; Firebase read/write permissions, live synchronization, reconnects, and floor/scene changes; shared pings and dice; and opaque player fog with light reveals and wall/door occlusion. Earlier verification items remain outstanding.

Known limits: one shared Gaia table and one active GM authority; the GM view must remain open to process player movement and door requests. The URL role switch controls the interface and is not authentication or server-side authorization. Firebase access to the new shared-table path has not been verified.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.


## Prop actions, attached lighting, and chest inventory saved - 2026-11-23

- Extends GM right-click menus with door open/close, lock/unlock, hide/show, delete, and light placement; light on/off, hide/show, delete, icon, color, and intensity; and paired portal use and light placement.
- All props share Delete, Hide/Show, Change icon, and lighting actions, with chest/crate and ladder actions retained. GM VTT Select supports left-drag movement of props, portals, and lights with previews in both views. Moving a decorative ladder also moves its colocated portal endpoint.
- Prop lighting is attached: Add light becomes Remove light and Edit light, using the existing color/intensity window. Attached lights follow prop movement and hidden state, are removed with their prop, and retain their association in map exports/imports. Previously placed standalone lights remain independent.
- Adds a standard-width chest contents window. GMs can add/remove named items and open/close or lock/unlock chests and crates. Players can inspect lock state, request open/close, and take items when a selected PC is nearby and the container is open and unlocked.
- Reads the linked PC inventory from Firebase character records. GM-processed loot transfers write character inventory and shared chest removal together; stable item keys and transfer receipts support retries. Character inventory stays independent of token/scene data.
- Picking checks the PC inventory for lockpicks or thieves' tools with positive quantity. Missing tools report No lockpicks; available tools produce a shared raw d20 lockpicking result for GM resolution.
- Saves door visibility, light visibility/on-off state, prop icon changes, container state, and contents alongside existing geometry and synchronization data.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Existing Firebase PC inventory fields were read to establish the schema; this was not application verification. Outstanding work: verify GM actions and dragging in both views; attached-light add/edit/remove, movement, visibility, deletion, undo/redo and map/scene round trips; chest/crate permissions, proximity, lock state and contents windows; Firebase loot transfers, retry/error handling and simultaneous player actions; tool detection and shared lockpicking rolls; and scene/floor changes during requests. Earlier verification items remain outstanding.

Known limits: lockpicking modifiers and success/difficulty rules are pending, so the GM resolves the raw d20. Ladder Use requires a paired portal at its position. Player requests require the active GM session. Existing URL role selection is UI control, not authentication. Previously added standalone lights are not automatically attached to props.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.


## Build Controls, live light settings, and blank scenes saved - 2026-11-23

- Adds the GM Build Controls floating window using the standard panel width, dragging, snapping, and collapse behavior. Existing Edit menus and tool windows remain available.
- Build Controls uses material dropdowns for Walls, Floors, and Doors, and an object dropdown for Props. Dropdowns stay within the viewport and can open above their buttons. Lights and Portals enter placement directly; subsequent editing uses right-click menus. Doors place with two clicks, with deletion available through their right-click menu.
- Adds Tokens to VTT Controls and matches the 2D/3D toggle to its icon-button style. All VTT and Build option buttons, including New Scene, are icon-only with hover tooltips and accessible labels. Control icons are 30 percent smaller with their icon space preserved.
- Adds a boxed-plus New Scene button. It prompts for dimensions such as 20x20, accepts whole-number dimensions from 1 to 1000 per side, and opens a new unsaved blank scene with a visible grid in 2D. It reuses blank-floor generation and retains unsaved-scene replacement protection.
- Build Floors places individual tiles with a normal click. Left Shift-click fills or repaints the room using walls and all doors as boundaries, including open doors. Existing floor tiles receive the chosen material. The existing atomic 2000-object fill limit remains. Floor right-click actions allow material changes and deletion in both views.
- Light settings now expose color, intensity, and range and apply valid edits immediately without an Apply button. The same live behavior applies to selected lights in the legacy editor. The 2D light range overlay reflects intensity.
- Torch and brazier flames and their 2D icons follow the associated light color, including standalone light markers and attached prop lights. Colored flame materials are kept separate so changing one light does not recolor unrelated props.
- Sets 3D door thickness to 0.24 world units, twice wall thickness, for open and closed doors. Adds dark iron ring pulls and round mounting plates to both sides, sharing door movement, picking, shadows, and resource cleanup.
- Ladder and stairs Use now follows the colocated paired portal to its destination floor without requiring a token. Tokens on the entrance continue to travel. Moving either decorative ladder or stairs also moves its colocated endpoint.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: exercise icon-only controls, keyboard labels, collapse/drag/snap behavior and dropdown positioning near viewport edges; material and prop placement, two-click doors, direct light/portal placement and right-click editing; Left Shift room fills with open/closed doors, existing tiles and fill limits; live light edits, undo/redo, independent flame colors and persistence; door thickness, ring pulls and door picking; linked ladder/stairs travel with and without tokens; new-scene dimensions, cancellation, unsaved-change protection, grid visibility, saving and shared-session synchronization. Earlier verification items remain outstanding.

Known limits: building uses the 2D view; room filling follows grid-cell centers with a 2000-tile limit; ladder/stairs travel requires a paired portal at the prop position. Existing lockpicking and shared-table limitations remain.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.


## Matching square controls and compact floor navigation saved - 2026-11-23

- Build Controls and VTT Controls now share the same four-column layout and square buttons with centered, equally sized icons. Removes the wider three-column Build layout.
- Adds GM Up and Down arrows stacked vertically within one square in VTT Controls, retaining tooltips and accessible labels. The buttons reuse existing floor navigation, including creating blank floors at the top or bottom when needed.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or other application validation commands were run. Outstanding work: confirm matching square buttons at different viewport widths, the two floor arrows fitting within one square, tooltips and keyboard access, floor navigation in both views, blank floor creation at scene boundaries, and player visibility restrictions. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.

## Resizable floating controls and initiative saved - 2026-11-23

- Reduces VTT Controls and Build Controls windows and their contents by 30 percent. Adds Grid and Environment icons to VTT Controls.
- Adds a compact Initiative window showing up to four upcoming turns, score ordering, Next Turn cycling, and removal. Token right-click menus in 2D and 3D offer Edit token and Add to initiative; adding prompts for a score and updates an existing entry instead of duplicating it. Initiative state saves with each map/floor and uses existing live map synchronization. Adds unrun model assertions in tests/initiative.test.mjs.
- Adds compact Scene Controls with Load and Import menus for Battlemap or Scene, plus Save Map and Save Scene icons. These reuse existing actions and reflect their disabled states.
- Reworks Dice Controls with instant-roll d4, d6, d8, d10, d12, d20, and d100 icons, a quantity dropdown, and the existing modifier and d20 mode controls. Always attempts 3D presentation; removes the 3D option, Roll Dice, and Clear Tray buttons. Retains automatic tray cleanup, recent results, synchronization, and recorded-result fallback if 3D is unavailable.
- Removes the visible top bar and its layout offset. Retains hidden action elements and scene state needed by existing floating controls. Per user direction, does not relocate remaining menu actions or top-bar fields.
- Floating editor windows support native bottom-right resizing and Alt + arrow keys on their title bars. Anchors resizing at the top-left, sets minimum/maximum dimensions, preserves scrolling, and reflows VTT/Build/Scene icon grids by width. Collapsed controls retain title-only height and cannot resize until expanded.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: verify pointer and keyboard resizing, scroll behavior, icon reflow, collapse/expand after resizing, dragging/snapping and viewport changes; initiative ordering, cycling, removal, duplicate updates, map/floor persistence and player sync; Scene Controls load/import/save flows and disabled states; Grid and Environment actions; instant dice rolls, quantity limits, d20 advantage/disadvantage, 3D animation, cleanup and failure fallback; and full-height map layout without the bar. Earlier verification items remain outstanding.

Known limits: advantage/disadvantage applies to one d20; d100 quantity is capped at six. Initiative is stored per map/floor. Remaining top-bar-only actions and fields are no longer exposed, including window reopening from View, scene/floor naming, floor selection, Save Scene As, floor removal, and the initiative-active switch; this was accepted by the user. Window sizes are not persisted across reloads.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.

## Vertical control resizing saved - 2026-11-23

- Lowers VTT, Build, and Scene Controls minimum width to 2.5rem so their existing responsive grids can form a single vertical column.
- Lowers Dice Controls minimum width to 4rem and makes its icon grid responsive down to one column. Quantity and mode fields flex and shrink to fit narrow layouts.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: verify narrow single-column layouts, tall resizing, scrolling, dice dropdown usability, title truncation, and collapse/expand behavior. Earlier verification items remain outstanding. Window sizes are still not persisted across reloads.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.

## 3D placement, remembered window layouts, and door openings saved - 2026-11-23

- Enables Build Controls placement in 3D for walls, floors, doors, lights, portals, and props using the existing map model, snapping, room fills, and undo history. Adds flat floor placement indicators for prop footprints, floor tiles, points, and wall/door chains. Enter finishes chains and Escape cancels. Advanced editor selection remains in 2D.
- Enables the Tokens button and character picker in 3D, entering token placement through the existing build input handling. Shows a floor circle matching the selected token size and retains character templates, snapping, undo, and synchronization.
- Automatically remembers floating window positions, explicit resized dimensions, and VTT/Build collapsed states in localStorage, separately for GM and player views. Restores visible windows within the viewport; reopening hidden windows also clamps their positions. Layouts are local to the browser and are not part of map/scene files.
- Drawing doors or windows now removes the collinear overlapping wall span, preserving the remaining wall segments and material. Applies to chained placement and bucket-created segments; door insertion and wall cuts share one undo step. Adds unrun regression cases for wall splitting, full removal, unrelated/crossing walls, reversed endpoints, diagonals, and zero-length openings.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: exercise 3D Build and token placement, previews, snapping, chained doors/walls, keyboard completion/cancellation, room fills, undo/redo, and shared synchronization; confirm token picker loading and template sizes; check window layout restoration after refresh, collapsed/resized states, GM/player separation, smaller viewports, and unavailable browser storage; verify door/window wall cuts in both views and saved/reloaded maps. Earlier verification items remain outstanding.

Known limits: advanced selection tools remain in 2D; placement indicators are flat outlines rather than full object ghosts. Door openings cut only overlapping collinear walls, preserving crossing walls; deleting a door leaves its cut opening, while undo restores the original wall. Browser layout storage does not sync between devices and is lost when site data is cleared.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.

## Token picker without the Tools window saved - 2026-11-23

- Tokens now opens only the token picker and hides the legacy Tools window in both 2D and 3D.
- Routes both views through the existing token build placement mode, preserving the picker, templates, snapping, and undo behavior.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: confirm Tokens opens without Tools - Tokens in both views and that choosing and placing tokens still works. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.

## Custom PC tokens, token rotation, and permanent controls saved - 2026-11-23

- Adds selectable named miniatures for Lark, Liora, Ashara, Rurik, and Seris in the token Icon menu, with matching 2D symbols. Reuses the existing miniature cache and geometry/material disposal. Includes distinctive stature, clothing, hair, weapons, and accessories, including Lark's maroon beret and rapier, Liora's green cloak and boots, Ashara's flame hair and acolyte outfit, Rurik's bald head, red beard/moustache, monocle and beer glass, and Seris's purple hair and black longsword.
- Adds Rotate 90 degrees to the GM token right-click menu in both views. Rotates the 3D miniature, shows facing on 2D tokens, supports undo, and preserves normalized rotation through map import/export.
- Scene Controls, VTT Controls, Build Controls, and Initiative are permanent floating controls with minimize/restore buttons and remembered minimized state. Every other floating window retains its X close button. Reopening a permanent control restores its contents. Existing window sizes, positions, dragging, and snapping remain in use.
- Adds unrun assertions for named token appearance persistence, rotation import normalization, and permanent-window minimize/restore versus other-window closing.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: inspect the five miniatures and accessories in 3D; select/save/reload named icons; check 2D symbols and facing; exercise right-click rotation in both views, undo, map/scene round trips, and shared synchronization; confirm only the four permanent controls minimize and restore, minimized state survives reload, other windows close and reopen, and tool switching remains functional. Earlier verification items remain outstanding.

Known limits: named PC appearances are chosen manually from each token's Icon menu; rotation uses 90-degree steps. Window layouts remain local to the browser.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion, scene/blackpearl-whole.geezvtt modification, and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.

## Remove tokens from initiative saved - 2026-11-23

- Adds Remove from initiative to the GM token right-click menu when the token is in initiative, using the shared menu for both views and keyboard access.
- Removing the current token advances to the next turn; removing the last entry clears the current turn. Uses the existing map change flow for rendering, saving, and synchronization.
- Investigated the VTT floor up/down report by reading code. The user reported it working again before any floor navigation changes were made.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: check conditional menu visibility, removal of current and other tokens, empty initiative, both views, saving/reloading, and shared synchronization. Earlier verification items remain outstanding.

Save requested with commit and push to origin/main. Leave the unrelated README.md deletion, scene/blackpearl-whole.geezvtt modification, and untracked battlemap/mistyoaks.dd2vtt and to-do.md out of this commit.

## Firebase character windows and GM SRD inventory saved - 2026-11-23

- Adds separate Stats, Inventory, Feats, and Spells entries to the shared token right-click menu for linked PCs in 2D and 3D. Each opens its own standard-width closeable floating window, with existing dragging, resizing, snapping, and remembered layout support. Players can view the windows; existing token editing actions remain GM-only.
- Reuses the existing Firebase PC subscriptions to refresh combat values, spell-slot pips, equipment and bag contents, ability charges, origin feats and feature notes, and spells/cantrips. Reports synchronization failures in the affected windows and closes windows when their token or map is removed.
- Adds GeezVTT sheet.html with ?pc=<v2 entity ID> (or ?char=) and optional ?section=, using the same renderer and live Firebase reads. Copies SRD spells, equipment, and magic-item data from GeezSheets into GeezVTT for descriptions and item selection; GeezSheets remains unchanged.
- Adds a GM-only searchable SRD item field and quantity control to Inventory in the floating window and standalone sheet. Accepts equipment and magic items from the bundled SRD, validates the quantity and linked PC, and saves the item name, quantity, category, and description into the existing Firebase bag. Each addition uses its own key and retries reuse that key, preserving other bag entries and avoiding duplicate writes on a retry.
- Adds unrun renderer and inventory-write assertions covering sparse records, escaped text, spell pips, equipment, feats, quantities, stable write keys, unavailable PCs, and Firebase failures.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: check all four windows together in 2D/3D, closing/reopening and layout persistence, player viewing without add controls, live GeezSheets changes, standalone sheet URLs, SRD item search and quantities, saved bag items appearing in GeezSheets, failed-write retries, Firebase denial messages, and switching characters while saving. Earlier verification items remain outstanding.

Known limits: one window per category; opening that category for another PC changes its displayed character. Each inventory addition creates a separate bag entry instead of merging same-name stacks. Stats, equipment assignment, feats, spells, and existing bag entries remain view-only. GM controls follow the existing session-role convention and Firebase access still depends on the project's rules.

Save requested with commit and push to origin/main. All changes in this save are confined to GeezVTT.

## PC synchronization timeout fix saved - 2026-11-23

- Investigated the reported "PC sync failed: signal timed out" by reading inventory writes, PC subscriptions, and tabletop listeners. The existing PC code held one EventSource connection per linked character and issued another GET after every stream event. Combined with tabletop listeners, this can exhaust HTTP/1 browser connection slots and leave inventory writes or refreshes waiting until their 15-second timeout. This is a code-based diagnosis; no browser or live Firebase validation was performed.
- Replaces per-character subscriptions with one shared entities stream, matching the existing collection read scope. Applies Firebase put/patch payloads directly to cached records and refreshes linked token values and open character windows without additional GETs. Preserves reconnect, access-denied, unavailable-character, and error reporting and closes the shared stream when unused or the page exits.
- Removes the redundant post-inventory-save GET in the VTT; successful saves update through the shared stream. Retains existing inventory write validation and stable keys for safe retries. The standalone sheet retains its single-character stream and refresh callback.
- Adds unrun assertions for streamed snapshots, nested inventory additions, multi-path patches, deletions, array paths, unrelated characters, and rejection of unsafe paths before mutation.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: reload the VTT to replace the old connections, add an SRD item with multiple PCs placed, confirm the bag and GeezSheets update, and check live HP/spell/feat updates, reconnect and unavailable-character behavior. Other network or Firebase availability problems could still produce timeouts; the reported runtime cause has not been independently confirmed.

Saved for commit and push to origin/main under the existing save/commit/push request. Changes remain confined to GeezVTT.

## Equipment dropdowns, player bag actions, transfers, and skills saved - 2026-11-23

- Adds Helmet, Armor, Shield, and Weapon dropdowns to Inventory in both the VTT and standalone sheet. Offers suitable positive-quantity bag items and Unequip, retaining the existing GeezSheets equipment names, legacy weapon alias, and boolean shield format. Records a shield name beside the boolean so named magic shields remain identifiable. Players and the GM can equip and unequip.
- Adds bag right-click menus and accessible item action buttons for Remove, Add, and Transfer. Add increases the selected stack by one; Remove deletes the stack; Transfer opens a recipient-PC dropdown and transfers the whole stack, preserving quantity, descriptions, notes, and existing recipient entries. Empty-bag right-click Add focuses the item form. Players can add SRD equipment/magic items, and the GM can also enter custom item names.
- Enforces unequipping before removal or transfer using fresh Firebase state, including legacy weapon and shield records. Reads an ETag before each mutation and conditionally writes, retrying conflicts up to three times. Transfers update source and recipient together at their common entities location; concurrent sheet/equipment changes cause a retry instead of an overwrite. Unknown write outcomes tell the user to check the bag before retrying.
- Copies the existing GeezSheets SRD skills data into GeezVTT and adds all skills to Stats with explicit or computed bonuses, proficiency, and expertise. GeezSheets remains unchanged.
- Adds unrun assertions for equipment filtering and compatibility, unequip-before-remove/transfer, whole-stack transfer and metadata preservation, existing recipient inventories, quantity increments, conditional-write retries after concurrent equipping, atomic transfer writes, rendered dropdowns/bag controls, and skill bonuses.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: exercise every slot and Unequip in GM/player views, legacy and named magic shields, custom named gear, all bag actions including empty bags, recipient choices and whole-stack quantities, concurrent equipment/removal attempts, Firebase write denial/conflict and timeout handling, standalone sheet controls, live synchronization, and skill bonuses. Earlier verification items remain outstanding.

Known limits: Remove and Transfer act on full stacks; bag-menu Add increments by one. Equipment matching uses SRD categories and item names for custom gear; same-name copies are conservatively protected while that name is equipped. Transfers conditionally update the entities collection so both bags change together, which requires write access there and transfers the collection payload. Existing role conventions and Firebase rules still govern access; no new player identity system or automatic AC recalculation is added.

Saved for commit and push to origin/main under the existing save/commit/push request. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit. All changes remain inside GeezVTT.

## Character rolls, editable combat, item modifiers, and coins saved - 2026-11-23

- Adds all six ability checks, saving throws, initiative, and clickable skills to Stats, plus a separate Weapons window for linked PCs. Selecting a roll opens the existing dice window, rolls the formula, and labels the result with the character and action. Supports formula editing, rerolling, advantage/disadvantage for a single d20, mixed weapon damage dice, and the existing shared-table roll broadcast. Roll broadcasts are temporary rather than permanent character history.
- Uses sheet bonuses without double-counting proficiency; expertise doubles proficiency. Equipped stat-score modifiers adjust ability checks, saves, initiative, and skill totals, including explicit recorded totals. Known SRD weapons or attacks with a recorded ability also adjust their stored attack bonuses and existing flat damage modifiers when the relevant ability modifier changes.
- Makes spell-slot pips clickable in the VTT and standalone sheet: an unused pip spends one slot, and a used pip restores one. Saves with Firebase ETags and rejects conflicting changes. Adds GM editing for current/max HP, temporary HP, base AC, exhaustion, and conditions. Exhaustion supports direct entry and +/- within 0–6. Conditions use an add/remove dropdown and filter Firebase empty-list metadata instead of displaying "array".
- Adds GM item editing through the bag action menu: name, quantity, Consumable/Armor/Weapon category, description, AC modifier, six stat-score modifiers, and all skill modifiers. Keeps existing categories and unrelated item metadata. Requires unequipping before renaming, changing category, or setting an equipped item's quantity to zero. Custom item creation remains available when reference loading fails.
- Stores item modifiers on the Firebase inventory entry and derives their effects while equipped, without rewriting base character values. Applies each equipped entry once regardless of stack quantity or duplicate slot references. Updates displayed AC and linked token AC; unequipping removes the derived bonuses. Consumables cannot be equipped, and automatic consumable activation is not added.
- Adds GM +/- controls for platinum, gold, electrum, silver, and copper, including PCs without an existing coin purse. Preserves other denominations and rejects negative or invalid balances. Inventory edits and coin adjustments reuse conditional Firebase writes and conflict retries; saved inventory snapshots refresh the VTT character windows and tokens.
- Adds unrun assertions for roll formulas and modifiers, accessible controls, GM versus player combat editing, slot and combat saves, conditions metadata, validation, equipped bonuses and removal, item metadata and transfer preservation, coin boundaries, and concurrent coin writes.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: exercise token-to-Stats/Weapons rolls in both views; compare sheet totals and equipped modifier changes; confirm dice window formulas, results, mode selection, and shared broadcasts; check spell-slot spending/restoring and concurrent-write errors; edit all GM combat fields and conditions in the VTT and standalone sheet; add/edit/equip/unequip/transfer custom items; confirm saved Firebase values and live updates; test every coin denomination, zero balances, access-denied responses, and character switching during saves. Earlier verification items remain outstanding.

Known limits: automatic item effects apply while equipped; consumable activation is not automated. Custom weapon attacks need a recorded ability or an SRD match for ability-based attack adjustments. Existing stored base AC is retained, with explicit item AC modifiers added; armor formulas are not inferred. GM controls follow the existing session-role convention and Firebase access remains governed by existing rules.

Save, commit, and push requested to origin/main. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit.

## First Person character controls and player session updates saved - 2026-11-23

- Adds the shared 2D / 3D / 1st Person cycle to VTT controls. First Person follows the player's current character; right-drag looks around, and WASD or arrow keys move relative to camera facing, snapped to the existing cardinal grid movement rules. The GM has a free camera. Restores the overhead camera when leaving First Person.
- Versions the renderer import to bypass the older cached renderer and fixes recovery from missing First Person methods. The user reported that the view button works after this fix.
- Adds a standard-width First Person character floating window with name, current/max HP, a colored health bar, AC, and Stats, Inventory, Feats, and Spells buttons. Reuses the existing character windows and their permission checks, along with shared dragging, resizing, minimizing, snapping, and remembered layouts. Updates character values from the existing map and selection events and hides the window outside First Person.
- Includes pending player session work: campaign/character sign-in, online presence, owned-PC selection and control checks, attributed dice rolls, and character sheet/inventory access for the signed-in PC.
- Includes pending synchronization work: a shared tabletop stream, changed-field live patches, a bounded movement queue, and Firebase key/empty-value encoding compatibility for character reads, streams, and conditional writes. Includes the associated unrun regression assertions and existing test updates.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run for this save. User confirmation covers the repaired view button only. Outstanding work: check First Person following and facing-relative movement, player collision/turn restrictions, returning to overhead views, the character window's values and four sheet buttons, dragging/resizing/minimizing and layout persistence, HP/AC synchronization, sign-in/ownership behavior, shared movement and dice, Firebase encoding, and reconnect/error handling. Earlier verification items remain outstanding.

Known limits: the GM camera can pass through walls; player movement retains the existing cardinal-step rules. Character selection trusts players under the existing role convention; Firebase Auth and ownership rules are still needed before use with untrusted players. Sheet buttons require a linked PC.

Save, commit, and push requested to origin/main. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit.


## Player turns, dynamic effects, spell use, and shared sheet viewing saved - 2026-11-23

- Adds a separate standard-width Player Turn floating window with movement, attack, action, bonus action, item, and End Turn controls. Stores shared turn IDs, spent movement, action usage, attack counts, and completed first turns. Reachable cells respect walls, closed doors/windows, map bounds, and remaining movement; movement can be split across the turn. Uses 5-ft diagonals and rejects stale turn requests through the GM session.
- Reads recorded Extra Attack, Dread Ambusher, and Hunter's Mark features. Liora's recorded SPD 30 becomes 40 ft with three attacks on her first turn, then 30 ft and two attacks on later turns. Hunter's Mark records bonus-action use. Attack, Item, and Hunter's Mark open the relevant sheet sections. Attacks, damage, spell slots, concentration, and item use were initially manual turn tracking; the subsequent spell-use controls now spend spell slots separately.
- Adds an Effects builder to both token sheets and sheet.html, including a Bark Arm preset: +2 AC/STR/CON, DEX and SPD multiplied by 0.5, two daily uses, and a 60-game-minute duration. Supports activated, passive, and equipped-item effects, optional consumable spending, editing existing recorded abilities, game-time advancement, rests, and daily resets. Uses conditional Firebase writes so uses, consumed items, and active state save together; protects equipped items from consumption.
- Shares base/current stat calculations across sheets, ability checks, saves, skills, initiative, weapon rolls, spellcasting totals, token AC/max HP, and movement. Keeps base values intact, applies set/add/multiply operations in a defined order, rounds down, derives CON-related maximum HP changes, and preserves current HP. Adds editable base scores and explicit stored/unarmored/equipped-armor AC modes with custom armor calculations and DEX caps. Existing AC defaults to Stored AC to preserve recorded totals.
- Adds Cantrips and Spells sections with shared level-based spell-slot pips, Use buttons, casting-level selection, and a separate standard-width Glossary window in the VTT and sheet.html. Glossary includes name, level, prepared status, casting time, range, duration, concentration, description, and higher-level details.
- Spell Use conditionally spends exactly one available shared slot; cantrips do not consume slots. Offers spell attacks, damage/healing rolls, and target-save/DC instructions using current character modifiers. Subsequent rolls do not spend another slot. Handles recorded scaling, separate Eldritch Blast/Scorching Ray attacks, and splits rolls beyond the tray's 12-die limit into numbered parts. Missing or special spell data falls back to glossary instructions, including incomplete upcast formulas.
- Allows players to inspect other PCs' Stats, Weapons, Inventory, Feats, Spells, and Effects in read-only mode. Owners and the GM retain mutation controls. Extends read access through the standalone sheet transport while keeping casting, slot/stat changes, inventory writes, and effect activation behind existing ownership checks.
- Adds regression cases for turn movement and first-turn bonuses, effect calculations and persistence, armor modes, base-score edits, consumption safety, spell use/scaling/pips/glossary rendering, conditional casting writes, and read-only access.

Verification: at the user's explicit request during the effects work, the targeted tests passed (47 cases at that stage), followed by 19 focused effects/transport cases after adding the equipped-item consumption safeguard. A temporary headless browser with mocked Firebase confirmed building/saving/activating Bark Arm in sheet.html; matching final ability scores, AC, speed, and maximum HP in actual right-click Stats; token updates; effect expiration; escaped names; and signed-in-player access to the builder without GM time controls. No live Firebase data was changed by those checks. Spell-use, Glossary, and expanded read-only sharing changes were made afterward; their new/updated regression cases have not been run. No tests or browser checks were run for this save. Further verification is left to the user.

Outstanding work: exercise the complete Player Turn flow across GM/player sessions and all views; check casting, pips, upcasting, glossary dragging/closing, dice prompts and target-save instructions; confirm all six other-PC sections remain read-only; verify effect activation/deactivation, game-time/rest resets, armor selection, conditional-write conflicts/timeouts, and live Firebase synchronization. Earlier outstanding verification remains applicable.

Known limits: ordinary terrain and 5-ft diagonal movement; higher-level Fighter and other attack-count features need additional metadata. Spell targets, hit/save outcomes, ongoing/special effects, concentration, and spell-linked effect activation remain manual. Effect durations advance per character using GM game-time controls. Existing role conventions and Firebase rules govern access. Live data and visual verification remain with the user.

Save, commit, and push requested to origin/main. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit.

## Player sheet permissions, compact windows, feats, and pending turn changes saved - 2026-11-23

- Makes base ability scores, AC, SPD, maximum HP, and AC calculation GM-only in sheet rendering and the shared character mutation functions. Players retain current/temporary HP, Exhaustion, conditions, and owned-character roll controls. HP displays current / computed maximum; ability score labels use STR, DEX, CON, INT, WIS, and CHA.
- Compacts Weapons into one row per weapon with Attack and Damage buttons, dice expressions in tooltips, and existing roll keys and unavailable states. Arranges Ability Checks and Saving Throws in three-column grids and skills in four columns (five rows for 18 skills). Uses Controls-style borders for ability totals and check tiles without changing standard floating-window width.
- Restricts bag Add and item creation/edit writes to the GM. Player item menus retain Remove and Transfer. Transfer accepts a positive whole-number quantity, preserves item metadata, leaves the remainder in the source bag, and conditionally saves both bags together using the existing ETag path. Remove continues to remove the entire stack.
- Collapses feat and ability descriptions behind a details button, with Use buttons and clickable charge pips for recorded limited uses. Saves charge changes through the existing conditional character update path; using configured ability effects delegates to existing activation/consumption logic. Plain descriptive feats open their description rather than inventing automated effects. Origin feats and feature/proficiency text use collapsed details.
- Adds a small dis marker to Stealth when equipped, positive-quantity armor has stealth_disadvantage in its item or reference data. Tooltip identifies the armor; a stored false overrides reference data. The numerical bonus remains unchanged. This is a visual reminder only: automatic disadvantage roll-mode selection remains outstanding.
- Includes previously pending initiative Start/End controls, PC-only player-turn window, turn inventory shortcut, object-interaction naming, keyboard movement gating, and GM-mediated equipment changes during initiative. Equipment changes use free object interaction/action budgets, reject armor changes during a turn, require an action for shields, and block turn/movement changes while saving equipment.
- Includes the pending to-do entries for traps/triggers, compartments/chests, carrying weight/encumbrance, and consumable effects.
- Adds or updates regression cases for player restrictions, partial transfers and atomic writes, GM controls, compact grids and weapon rows, feats and charge persistence, armor disadvantage markers, and pending equipment-turn rules. These cases have not been run.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run for these changes. Outstanding work: exercise GM/player sheet permissions, current/max/temp HP, Exhaustion and condition updates, all grid roll buttons, weapon tooltips/actions, partial transfers and concurrent changes, feat Use/pips/details and effect activation, live synchronization, Stealth marker removal when unequipped, initiative controls and equipment action budgets. Earlier outstanding verification remains applicable.

Known limits: existing role conventions and Firebase rules govern access. Feat descriptions do not automatically resolve healing, attacks, or other unconfigured mechanics. Stealth disadvantage is labeled but must still be selected in Dice Controls. Skill grids retain full names and may wrap in the standard-width panel; visual verification is pending.

Save, commit, and push requested to origin/main. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit.
## Index updater consolidation saved - 2026-11-23

- Consolidates token, battlemap, and scene scanning in `update_indexes.py`; run `python update_indexes.py` from any working directory.
- Retains sorted image filenames for tokens and append-only map/scene entries, preserving existing labels and metadata. Retains atomic replacement of each index file.
- Routes `push_repo.py` through the shared three-directory updater, removes the separate token updater, updates the to-do reference, and consolidates regression cases.

Verification is left to the user. No tests, updater execution, browser checks, or other application validation commands were run. Outstanding work: run the regression cases and verify index generation and the publish workflow. Commands using `update_token_index.py` must switch to `update_indexes.py`.

Save, commit, and push requested to origin/main. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit.


## Token source dropdowns saved - 2026-11-23

- Splits the Tokens floating window into PC, NPC, and /Token dropdowns, retaining the standard panel width and Blank Token option.
- Keeps PCs and NPCs in separate lists from the existing character catalog. Selecting any source clears the other two and sets the map placement template.
- Populates /Token from token/index.json through the existing image loader. Folder images create standalone tokens with the selected image, a filename-derived name, size 1, and 0 HP.
- Updates browser regression assertions for NPC separation, independent image templates, and clearing other source selections.

Verification is left to the user. No tests, browser checks, visual inspections, or application validation commands were run. Outstanding work: exercise all three dropdowns, placement and replacement, PC synchronization, blank tokens, image rendering, and saving/reloading spawned tokens. Folder images have no linked character stats; adjust size and HP as needed.

Save, commit, and push requested to origin/main. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit.

## Expanded map materials saved - 2026-11-23

- Adds separate floor, door, and wall material selections to build menus and editor palettes; floor context menus use the floor selection. Retains the original five materials in every layer for compatibility.
- Floors add water, grass, dirt, cracked rock, snow, marble, burnt wood, moss, blood, sand, mud, gravel, ice, lava, swamp, tile, carpet, and ash.
- Doors add dark wood, reinforced wood, burnt wood, rusty iron, bronze, marble, and curtain finishes. Walls add sandstone, limestone, marble, plaster, timber, mossy stone, cave, hedge, ice, obsidian, and burnt wood.
- Adds procedural textures shared by swatches, 2D patterns, and 3D materials, with metallic shading for rusty iron and bronze. Existing material metadata carries the new names through map saving and loading.
- Adds an unrun regression case for layer material definitions, texture generation, caching, and unknown-material fallback.

Verification is left to the user. No tests, browser checks, visual inspections, syntax checks, or application validation commands were run. Outstanding work: verify all material menus, swatches, placement and repainting, 2D/3D appearance, and save/reload behavior. Door additions are visual finishes using existing door interactions; curtain uses ordinary door behavior. Earlier verification items remain outstanding.

Save, commit, and push requested to origin/main. Leave the unrelated scene/blackpearl-whole.geezvtt modification out of this commit.
