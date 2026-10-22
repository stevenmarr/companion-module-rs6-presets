'use strict';
// 0.7.1: every preset uses one text size (auto, so long names shrink instead of clipping), a family background image (png64), and lit
// feedback states that swap in their own image; action and feedback ids are unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../src/logic');

const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'app-state-0.3.0.json'), 'utf8'));
const isPng72 = (b64) => { const b = Buffer.from(b64, 'base64'); return b.slice(1, 4).toString() === 'PNG' && b.readUInt32BE(16) === 72 && b.readUInt32BE(20) === 72; };

test('0.7.1 styles: same text size and a 72x72 background on every button', () => {
  const p = L.buttonPresets(fixture());
  assert.ok(Object.keys(p).length > 20);
  for (const [id, b] of Object.entries(p)) {
    assert.equal(b.style.size, L.TEXT_SIZE, `${id} text size`);
    assert.ok(b.style.png64 && isPng72(b.style.png64), `${id} background`);
    assert.equal(b.style.show_topbar, false, `${id} top bar`);
    for (const f of b.feedbacks) if (f.style && f.style.bgcolor !== undefined && f.feedbackId !== 'input_problem') assert.ok(f.style.png64 && isPng72(f.style.png64), `${id} ${f.feedbackId} lit background`);
  }
});

test('0.6.0 styles: families look different, lit states differ from normal', () => {
  const p = L.buttonPresets(fixture());
  const fam = { preset: p.preset_1, master: p.master_mem_4, dest: Object.values(p).find((b) => b.category === 'Destinations'), take: p.take, cut: p.cut, auto: p.auto_take, refresh: p.refresh_memories, last: p.last };
  const imgs = Object.values(fam).filter((b) => b !== p.last).map((b) => b.style.png64);
  assert.equal(new Set(imgs).size, imgs.length, 'one background per family');
  assert.notEqual(p.preset_1.feedbacks[0].style.png64, p.preset_1.style.png64);
  assert.notEqual(p.preset_1.feedbacks[0].style.png64, p.preset_1.feedbacks[1].style.png64);
  assert.equal(p.take.style.bgcolor, L.COLORS.red);
});

test('0.6.0 styles: action and feedback ids unchanged', () => {
  const p = L.buttonPresets(fixture());
  const actions = new Set(); const feedbacks = new Set();
  for (const b of Object.values(p)) { for (const s of b.steps) for (const a of s.down) actions.add(a.actionId); for (const f of b.feedbacks) feedbacks.add(f.feedbackId); }
  const knownA = ['recall_preset', 'load_master_memory', 'refresh_memories', 'toggle_destination', 'take', 'cut', 'auto_take', 'input_freeze', 'backup_trigger', 'audio_mute'];
  const knownF = ['preset_pvw', 'preset_pgm', 'master_memory', 'dest_selected', 'auto_take_on', 'input_pvw', 'input_pgm', 'input_problem', 'input_frozen', 'backup_active', 'audio_muted'];
  for (const a of actions) assert.ok(knownA.includes(a), a);
  for (const f of feedbacks) assert.ok(knownF.includes(f), f);
});
