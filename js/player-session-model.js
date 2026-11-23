export const CAMPAIGNS = ['disney', 'daddies'];
export const CHARACTERS = ['Seris', 'Liora', 'Lark', 'Rurik', 'Kairon', 'Ashara'];
export const PRESENCE_TIMEOUT = 90000;

export function validPlayer(player) {
  return CAMPAIGNS.includes(player?.campaign) && CHARACTERS.includes(player?.character) &&
    typeof player?.pcId === 'string' && /^[^.#$\[\]/\s]{1,200}$/.test(player.pcId);
}
export function ownsPC(player, token) {
  return validPlayer(player) && token?.npcId === `v2:${player.pcId}`;
}
export function resolvePlayer(entities, campaign, character) {
  if (!CAMPAIGNS.includes(campaign) || !CHARACTERS.includes(character)) throw new Error('Choose a campaign and character.');
  const matches = Object.entries(entities || {}).filter(([, entity]) => entity?.kind === 'pc' && entity.data && !entity.data._sheetsDeleted &&
    typeof entity.name === 'string' && entity.name.trim().toLowerCase() === character.toLowerCase() &&
    String(entity.campaign ?? entity.data.campaign ?? '').toLowerCase().replace(/^world__/, '') === campaign);
  if (matches.length !== 1) throw new Error(matches.length ? 'Multiple matching PCs; ask the GM to check the records.' : 'That PC was not found in this campaign.');
  const player = { campaign, character, pcId: matches[0][0] };
  if (!validPlayer(player)) throw new Error('Invalid PC record.');
  return player;
}
export function activePresence(player, now = Date.now()) {
  return validPlayer(player) && Number.isFinite(player.lastSeen) && Math.abs(now - player.lastSeen) < PRESENCE_TIMEOUT;
}
