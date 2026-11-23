# GeezVTT progress

Updated: 2026-11-22

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
