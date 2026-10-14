// Root-scoped service worker for GitHub Pages project hosting.
// Revving the root worker forces older installations to fetch the newest script.
importScripts('./public/sw.js?v=arcane-proportional29');
