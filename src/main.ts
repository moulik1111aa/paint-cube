// Paint Cube entry point. For now the app opens on the look test.

import { showLookTest } from './ui/looktest.ts';

const app = document.getElementById('app');
if (app) showLookTest(app);
