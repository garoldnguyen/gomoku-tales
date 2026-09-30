import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from './config.js';

const canvas = document.getElementById('game');
canvas.width = INTERNAL_WIDTH;
canvas.height = INTERNAL_HEIGHT;

const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

ctx.fillStyle = '#1e1b2e';
ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

ctx.fillStyle = '#fff';
ctx.font = 'bold 48px monospace';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('Gomoku Tales', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2);
