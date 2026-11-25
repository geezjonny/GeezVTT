import { randomDie } from './dice-roll.js';
import { WORD_LABELS, WORD_COUNT, revealBargain } from './devils-deck-model.js';

const button = document.getElementById('roll'), board = document.querySelector('.board');
const status = document.getElementById('status'), item = document.getElementById('item');
const cards = [...document.querySelectorAll('.word-card')];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

button.disabled = false;
status.textContent = 'The dealer is waiting.';
button.addEventListener('click', async () => {
  if (button.disabled) return;
  button.disabled = true;
  board.setAttribute('aria-busy', 'true');
  item.hidden = true;
  document.getElementById('meaning').open = false;
  for (const card of cards) {
    card.classList.remove('revealed');
    card.querySelector('.die').textContent = '?';
    card.querySelector('h2').textContent = 'Unspoken';
    card.querySelector('.whisper').textContent = 'The table waits.';
  }
  try {
    const bargain = revealBargain([randomDie(WORD_COUNT), randomDie(WORD_COUNT), randomDie(WORD_COUNT)]);
    for (const [index, card] of cards.entries()) {
      const label = card.querySelector('.eyebrow').textContent;
      status.textContent = `Rolling ${label.toLowerCase()}…`;
      card.classList.add('rolling');
      if (!reducedMotion.matches) {
        for (let tick = 0; tick < 10; tick++) {
          card.querySelector('.die').textContent = randomDie(WORD_COUNT);
          await pause(65 + tick * 8);
        }
      }
      const [word, , whisper] = bargain.words[index];
      card.classList.remove('rolling');
      card.classList.add('revealed');
      card.querySelector('.die').textContent = bargain.rolls[index];
      card.querySelector('h2').textContent = word;
      card.querySelector('.whisper').textContent = whisper;
      status.textContent = `${label}: ${bargain.rolls[index]} — ${word}.`;
      if (!reducedMotion.matches) await pause(300);
    }
    document.getElementById('item-name').textContent = bargain.name;
    document.getElementById('item-flavor').textContent = bargain.flavor;
    const rules = document.getElementById('item-rules');
    rules.replaceChildren();
    for (const [index, [word, meaning]] of bargain.words.entries()) {
      const term = document.createElement('dt'), description = document.createElement('dd');
      term.textContent = `${WORD_LABELS[index]} · ${word}`;
      description.textContent = meaning;
      rules.append(term, description);
    }
    item.hidden = false;
    status.textContent = `${bargain.name}. The bargain is revealed.`;
    button.textContent = 'Roll another bargain';
  } catch (error) {
    status.textContent = `The roll could not finish: ${error.message}`;
  } finally {
    cards.forEach(card => card.classList.remove('rolling'));
    button.disabled = false;
    board.setAttribute('aria-busy', 'false');
  }
});
