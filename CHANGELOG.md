# Changelog

## 2026-11-25

### Token and light tweaks
- Free roam is switched back on: the GM's Movement button is back in VTT Controls, and players hold WASD to move smoothly (initiative still forces turn-based).
- Tokens are drawn and collide a bit smaller than their square (85%), so a 1-square token now fits through a 5 ft door.
- Light range circles are no longer drawn for anyone; the lighting itself is what shows. The small light dot is still there to select.
- New GM right-click option on a token: Delete token (Ctrl+Z brings it back).
- Not yet checked in a browser: free roam, the smaller tokens and door passing, and Delete token.

### 3D removed, animated 2D dice
- The table is 2D only now: the 3D view, first-person view, their View menu and toolbar buttons, and the first-person character window are gone. A map opens straight into 2D instead of switching to 3D on load.
- The page no longer downloads three.js, so it loads lighter and has less to break.
- Dice are now animated 2D: each die tumbles in, shows rolling numbers, and lands on its result with a small thud. Dropped dice from advantage fade, a natural 20 glows gold and a natural 1 goes dark red, with the total shown underneath. Reduced-motion devices skip the tumble.
- Arrow keys no longer move a token (they only did in first person). WASD still does.
- Not yet checked in a browser: the dice animation, token drag and door toggles in 2D, and the editor's paint and erase tools.

### Character sheet windows (index.html)
- Stats, Inventory, Weapons, Feats, Spells and Effects windows are wider and open side by side without overlapping, so their content is no longer squeezed.
- Stats: HP, Temp HP, AC, Exhaustion and speed pair up in rows, and the ability, save and skill grids fill the available width.
- Inventory: equipment slots and coins sit in columns, and bag items are compact cards.
- Cleaner section headings, tighter spacing, and empty status lines no longer leave gaps.

## 2026-11-24

### Life-drain effects and Character Workshop (creator.html)
- Effects can now feed on their user's life force: roll a die (like a d4) at the start of each of their turns and/or every N game minutes while the effect is active, never taking them below a set HP. The roll is posted to the table and the character's HP updates.
- Added Lark's Bark Arm: STR +2, speed x1.5, CON -2, CHA -2, two uses a day for an hour, draining a d4 each turn.
- Character Workshop: the Effect and Feat forms have life-drain fields, and the page got a layout pass: sections with short hints, aligned checkboxes, one stat change per row with a small remove button, a plain-words summary of the effect as you edit, and a Save button that stays on screen.

### Free roam (built, switched off for now)
- Built a Free roam mode: the GM gets a Movement button in VTT Controls, and players hold WASD to move smoothly in 2D, 3D and first person (walls, windows and closed doors still block). Initiative always stays turn-based.
- Fixed it jittering: a player's token no longer snaps back when the GM's updates arrive, and the map no longer redraws on every step.
- It is switched off for now (one flag, `FREE_ROAM_ENABLED` in `js/player-actions.js`); play stays turn-based until it has had a dry run with several players. Minigames will live on their own page.

### Minigame page (minigame.html)
- The minigame page is now a map-building and walking sandbox: GM tools for walls, floors, doors, lights, levers and tokens (PC, NPC or a picture from `token/`), plus a Connect tool to link levers to doors. Maps save and load as `.geezmg`.
- Right-click opens the object menu for any object, erase and select now pick the nearest wall instead of a neighbour, and the browser's own right-click menu is off on the page.
- Players' camera follows their character. The lighting overlay is off for now, and light dots are GM-only.

### Minigame removed
- The Zombie Horde minigame and the walking/puzzle minigame are gone: their pages, scripts, tests, puzzle files and the Minigame menu and scene-bar buttons. Nothing else in the tabletop depended on them.

### Card Creator
- New GM-only Card Creator window (menu: Card Creator): build a card with ability score bonuses, skill modifiers, stat changes, effects, feats and conditions, give it to any character, and optionally equip it to their card slot in one step.
- Equipped cards count in the character's totals, so a +2 STR card helps every STR check, save and attack. Feats and card conditions show only while the card is equipped.
- Players can fill an empty card slot, but only the GM can unequip or swap an equipped card.

### Campaign pinboard (campaign.html)
- The old campaign pin board is back as its own page: `campaign.html?gm=jonny` for the DM board, plain `campaign.html` for the party. It only shows the pinboard (no world, area or battle-map views) and reads the same Firebase data as the rest of GeezVTT. The old code it needs lives in `legacy/`.
- Portraits load again (from `token/`), and the campaign picker only lists real campaigns, not loose battle maps like blackpearl2 and skybridge.
- DM: each NPC card has a status chip; click it to cycle Alive, Dead, Unknown.
- Fixed NPC status snapping back on refresh: the board's saved status now also updates the character's own status, which used to win on load.

### Zombie Horde (minigame.html)
- The GM can create, start and end a game straight from `minigame.html?gm=jonny`: pick the campaign, who plays, optional roles and zombie speed. No trip through the tabletop needed.
- Ashara (touch heal): she can now walk, hold Space beside a hurt ally and release in the gold zone to heal; a perfect release heals everyone beside her and stands downed allies back up. Her glyph game is the second stance, now played with the arrow keys (N/W/S/E) with a note per glyph.
- Liora (teleport slash): new second stance (Tab). Rings close on the zombie nearest the gate; Space as they meet teleports her there for a sweep, with a bigger hit on a perfect press.
- Bards (Lark and Rurik): both now play the same metronome game. A metronome always ticks. Cutting words is typing zombie words with bonus damage on the beat; hold person is pressing the shown arrows on their beats (WASD walks) to pin zombies.
- Fixes: a hint-text typo that broke the page, a repeating HUD error on the empty waiting screen, and the setup form not showing. The metronome is a small corner pendulum while typing so it no longer covers words.
