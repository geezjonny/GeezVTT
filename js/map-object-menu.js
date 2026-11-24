import { OBJECT_EFFECTS, visualEffects } from './object-effects.js';

const objectMenu = document.createElement('div');
objectMenu.id = 'map-object-menu';
objectMenu.setAttribute('popover', 'auto');
objectMenu.setAttribute('role', 'menu');
objectMenu.setAttribute('aria-label', 'Object actions');
document.body.append(objectMenu);
let menuOrigin, menuPosition={x:0,y:0};
export function objectDisplayItems(layer,object) {
  const dispatch=(type,extra={})=>document.getElementById('floor').dispatchEvent(new CustomEvent(type,{detail:{layer,id:object.id,...extra}}));
  return [
    {label:'Edit colors...',action:()=>dispatch('object-colors')},
    {label:'Add effect...',action:()=>{
      const {x,y}=menuPosition, active=visualEffects(object.visualEffects), origin=menuOrigin;
      showMapMenu(x,y,[...Object.entries(OBJECT_EFFECTS).map(([effect,label])=>({
        label:active.includes(effect)?`${label} (added)`:label,disabled:active.includes(effect),action:()=>dispatch('object-effect',{effect})
      })),{label:'Remove effects',disabled:!active.length,action:()=>dispatch('object-effect',{effect:null})}],origin);
    }},
    {label:object.hidden?'Reveal':'Hide',action:()=>dispatch('object-hide')},
    {label:'Bring forward',action:()=>dispatch('object-order',{step:1})},
    {label:'Send backward',action:()=>dispatch('object-order',{step:-1})}
  ];
}
export function closeMapMenu() {
  objectMenu.hidePopover();
}
export function showMapMenu(x, y, actions, origin = document.activeElement, anchor = null) {
  menuOrigin = origin;
  objectMenu.replaceChildren(...actions.map(({ label, action, icon, disabled = false }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = label;
    if (icon) button.prepend(icon);
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
  const top=anchor && y+objectMenu.offsetHeight>window.innerHeight?anchor.top-objectMenu.offsetHeight:y;
  objectMenu.style.top = Math.max(0, Math.min(top, window.innerHeight - objectMenu.offsetHeight)) + 'px';
  menuPosition={x:parseFloat(objectMenu.style.left),y:parseFloat(objectMenu.style.top)};
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
