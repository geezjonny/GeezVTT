import { GRAPHICS, graphicsLevel, nextGraphicsLevel, onGraphicsChange, setGraphicsLevel } from './graphics-settings.js';

const button = document.querySelector('#vtt-graphics');
if (button) {
  const show = () => {
    const { label } = GRAPHICS[graphicsLevel()];
    button.dataset.level = label[0];
    button.title = `Graphics: ${label}. Click to change`;
    button.setAttribute('aria-label', `Graphics: ${label}`);
  };
  button.addEventListener('click', () => setGraphicsLevel(nextGraphicsLevel(graphicsLevel())));
  onGraphicsChange(show);
  show();
}
