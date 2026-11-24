# Changelog

## 2026-11-24

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
