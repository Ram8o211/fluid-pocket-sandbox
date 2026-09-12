// Optional Playwright suite. Run after installing @playwright/test in an environment with browsers.
// Intentionally kept out of the zero-dependency MVP runtime.
export const mobileSmokePlan = [
  'open app at 390x844','create material','randomize material','enter pour mode','pause/resume','load preset',
  'resize box','drag manual gravity','heat/cool region','export/import setup'
];
