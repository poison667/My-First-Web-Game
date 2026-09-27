import { Game } from './Game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
window.__GAME__ = game; // for debugging
game.init().catch((e) => {
  console.error(e);
  document.getElementById('loadmsg').textContent = 'Error: ' + e.message + ' (see console)';
});
