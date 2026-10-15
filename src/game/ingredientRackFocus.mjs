// Compact-screen UI only. Keep the shop's ingredient selection and brewing
// handlers unchanged; the rack remains mounted and fully interactive.
const toggle = document.getElementById('ingredientRackToggle');
const rack = document.getElementById('ingredientRack');
const panel = toggle?.closest('.ingredient-panel');
if (toggle && rack && panel) {
  const setOpen = open => {
    panel.classList.toggle('rack-expanded', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide ingredient choices' : 'Show ingredient choices');
  };
  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('rack-expanded')));
  rack.addEventListener('click', event => {
    if (event.target.closest('[data-ingredient]') &&
        matchMedia('(max-width:699px) and (max-height:720px)').matches) setOpen(false);
  });
}
