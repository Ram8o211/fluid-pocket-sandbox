// Optional Playwright suite. Run after installing @playwright/test in an environment with browsers.
// Intentionally kept out of the zero-dependency MVP runtime.
export const mobileSmokePlan = [
  'open app at 390x844','verify compact toolbar and collapsed drawer','create material','randomize material','paint fluid without camera movement',
  'switch eraser size and erase locally','pinch with two touches to zoom while brush is selected','two-finger orbit while eraser is selected','one-finger orbit in camera mode','inspect an emergent mixed material and save it to the reusable palette','switch graphics to coarse density clouds and lower resolution/effects',
  'pause/resume','load preset','resize box','drag manual gravity','heat/cool region','export/import setup'
];
