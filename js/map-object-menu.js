const objectMenu = document.createElement('div');
objectMenu.id = 'map-object-menu';
objectMenu.setAttribute('popover', 'auto');
objectMenu.setAttribute('role', 'menu');
objectMenu.setAttribute('aria-label', 'Object actions');
document.body.append(objectMenu);
let menuOrigin;
export function closeMapMenu() {
  objectMenu.hidePopover();
}
export function showMapMenu(x, y, actions, origin = document.activeElement) {
  menuOrigin = origin;
  objectMenu.replaceChildren(...actions.map(({ label, action, disabled = false }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', () => {
      closeMapMenu();
      menuOrigin?.focus();
      action();
    });
    return button;
  }));
  objectMenu.showPopover();
  objectMenu.style.left = Math.max(0, Math.min(x, window.innerWidth - objectMenu.offsetWidth)) + 'px';
  objectMenu.style.top = Math.max(0, Math.min(y, window.innerHeight - objectMenu.offsetHeight)) + 'px';
  objectMenu.querySelector('button:not(:disabled)')?.focus();
}
objectMenu.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation();
    closeMapMenu(); menuOrigin?.focus();
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const buttons = [...objectMenu.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
      (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
  } else if (event.key === 'Tab') closeMapMenu();
});
window.addEventListener('resize', closeMapMenu);
document.addEventListener('scroll', closeMapMenu, true);
