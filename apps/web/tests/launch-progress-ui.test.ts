import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dialog = readFileSync(new URL('../src/create/launch-progress-dialog.ts', import.meta.url), 'utf8').replace(/\bctx\./g,'');
const styles = readFileSync(new URL('../src/create/launch-progress.css', import.meta.url), 'utf8').replace(/\bctx\./g,'');
const app = readFileSync(new URL('../src/controllers/create.ts', import.meta.url), 'utf8').replace(/\bctx\./g,'');

test('launch progress gives completed and current stages distinct icons', () => {
  assert.match(dialog, /ph ph-check-circle/);
  assert.match(dialog, /ph ph-circle-notch/);
  assert.match(dialog, /aria-current/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('successful launch uses one listing page after the completion transition', () => {
  assert.match(app, /await finishLaunchProgress\(/);
  assert.match(app, /phase==='complete'\)\{void presentCompletedLaunch\(\);return;/);
  assert.doesNotMatch(app, /outcome:launchProgress/);
  assert.match(dialog, /state.step === 'Launch complete' && stageName === 'Complete'/);
});
