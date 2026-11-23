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
- Includes Three.js 0.170.0 through a pinned CDN import map and exposes it as `window.THREE`. No Three.js scene or renderer is created yet. Local map import runs independently of the CDN download.

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

## Scope remaining

This is an incremental, local map-import prototype. It has no persistence, multiplayer synchronization, Firebase integration, pan/zoom, geometry editing, interactive door state changes, calculated visibility, or dynamic lighting yet. The broader features in `plan.md` remain to be implemented as requested.

No deployment or commit has been performed. Existing unrelated working-tree changes were left in place.
