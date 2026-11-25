import { isGM } from './session-role.js';
import { oracleRequest, parseOracleDraft, ollamaURL } from './deck-oracle-model.js';

export function mountDeckOracle(getBargain) {
  const $ = id => document.getElementById(id), panel = $('deck-oracle');
  if (!isGM) return { reset() {} };
  panel.hidden = false; $('deck-creator').hidden = false;
  $('oracle-origin').textContent = location.origin;
  let controller, draft;
  $('oracle-cancel').addEventListener('click', () => controller?.abort());
  $('oracle-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (controller || !getBargain()) return;
    const bargain = getBargain();
    const request = new AbortController(); controller = request; draft = null;
    const timer = setTimeout(() => request.abort(), 180000);
    $('oracle-answer').hidden = true; $('oracle-ask').disabled = true; $('oracle-cancel').hidden = false;
    for (const id of ['oracle-url', 'oracle-model', 'oracle-draw']) $(id).disabled = true;
    $('oracle-status').textContent = 'The oracle is considering your omen…';
    try {
      const body = oracleRequest(bargain, Number($('oracle-draw').value), $('oracle-model').value);
      const response = await fetch(ollamaURL($('oracle-url').value), { method: 'POST', credentials: 'omit',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: request.signal });
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(String(result.error || `Ollama returned ${response.status}`).slice(0, 300));
      if (result.done === false || result.done_reason === 'length') throw new Error('Oracle stopped before finishing. Ask again.');
      if (typeof result.response !== 'string' || result.response.length > 40000) throw new Error('Oracle response is unavailable or too long.');
      const interpreted = parseOracleDraft(JSON.parse(result.response));
      if (getBargain() !== bargain || request.signal.aborted) return;
      draft = interpreted;
      $('oracle-kind').textContent = `${draft.kind} · ${draft.name}`;
      $('oracle-description').textContent = draft.description;
      $('oracle-scaling').textContent = `Draw ${$('oracle-draw').value}: ${draft.scaling}`;
      $('oracle-answer').hidden = false;
      $('oracle-status').textContent = 'Draft ready. No character changes made.';
    } catch (error) {
      if (getBargain() === bargain) $('oracle-status').textContent = request.signal.aborted ? 'Oracle request cancelled or timed out.'
        : `${error.message} Check that Ollama is running, the model is installed, and this origin is allowed in OLLAMA_ORIGINS.`;
    } finally {
      clearTimeout(timer);
      if (controller === request) controller = null;
      $('oracle-ask').disabled = !getBargain(); $('oracle-cancel').hidden = true;
      for (const id of ['oracle-url', 'oracle-model', 'oracle-draw']) $(id).disabled = false;
    }
  });
  $('oracle-edit').addEventListener('click', () => {
    if (!draft) return;
    try {
      sessionStorage.setItem('geezvtt.creator-draft', JSON.stringify(draft));
      const url = new URL('creator.html', location.href); url.searchParams.set('gm', 'jonny'); url.searchParams.set('draft', '1');
      const pc = new URLSearchParams(location.search).get('pc'); if (pc) url.searchParams.set('pc', pc);
      location.assign(url);
    } catch (error) { $('oracle-status').textContent = `Could not open draft: ${error.message}`; }
  });
  return { reset() {
    controller?.abort(); draft = null;
    $('oracle-answer').hidden = true; $('oracle-ask').disabled = !!controller || !getBargain();
    $('oracle-status').textContent = getBargain() ? 'Ask for a playable interpretation.' : 'Roll an omen first.';
  } };
}
