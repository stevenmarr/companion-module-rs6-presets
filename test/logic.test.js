'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const L = require('../src/logic');
const { AppApi } = require('../src/api');

const STATE = {
  connected: true, autoTake: true, selection: ['S1', 'S3'],
  lastRecalled: { number: 2, name: 'Wide' }, programPresets: [1],
  destinations: [{ key: 'S1', label: 'Center' }, { key: 'S3', label: 'Right' }, { key: 'A1', label: 'Conf' }],
  presets: [
    { number: 1, name: 'Walk-in', tally: { pvw: 'none', pgm: 'full' } },
    { number: 2, name: 'Wide', tally: { pvw: 'full', pgm: 'partial' } },
  ],
};

test('tally feedback logic', () => {
  assert.equal(L.presetTally(STATE, 1, 'pgm'), true);
  assert.equal(L.presetTally(STATE, 1, 'pvw'), false);
  assert.equal(L.presetTally(STATE, 2, 'pvw'), true);
  assert.equal(L.presetTally(STATE, 2, 'pgm'), false);
  assert.equal(L.presetTally(STATE, 2, 'pgm', true), true);
  assert.equal(L.presetTally(STATE, 9, 'pgm', true), false);
  assert.equal(L.presetTally(null, 1, 'pgm'), false);
  assert.equal(L.destSelected(STATE, 's3'), true);
  assert.equal(L.destSelected(STATE, 'A1'), false);
  assert.equal(L.variableValues({ ...STATE, transitionTargets: [] }).selection, 'S1,S3');
  assert.equal(L.variableValues({ ...STATE, transitionTargets: ['A1'] }).selection, 'A1');
});

test('recall applies the destination group assigned on the preset', () => {
  const presets = [{ number: 4, name: 'Wide', destinations: ['S1'], master: { slot: 2, dests: ['S2', 'A1'] }, targets: ['A1', 'S1', 'S2'] }];
  // an app without transitionTargets (before 0.3.1) does not move the selection itself: the module does
  const before = { selection: ['S3'], presets };
  assert.deepEqual(L.presetTargets(presets[0]), ['A1', 'S1', 'S2']);
  assert.deepEqual(L.selectionToApply(before, 4), ['A1', 'S1', 'S2']);
  // 0.5.0: apps with transitionTargets (0.3.1+) select the recalled preset's screens themselves; the module must
  // not POST a second selection (it raced the app)
  assert.equal(L.selectionToApply({ selection: ['S3'], transitionTargets: ['S3'], presets }, 4), null);
  // old app: only destinations the app knows
  assert.deepEqual(L.selectionToApply({ selection: ['S3'], destinations: [{ key: 'S1' }, { key: 'S2' }], presets }, 4), ['S1', 'S2']);
  assert.equal(L.selectionToApply({ selection: ['S2', 'A1', 'S1'], presets }, 4), null);
  assert.equal(L.selectionToApply({ selection: ['S1'], presets: [{ number: 3, name: 'Panel' }] }, 3), null);
  assert.deepEqual(L.presetTargets({ destinations: ['s2'], master: { dests: ['S2', 'A1'] } }), ['S2', 'A1']);
});

test('variables', () => {
  const v = L.variableValues(STATE);
  assert.equal(v.last_preset_number, 2); assert.equal(v.last_preset_name, 'Wide');
  assert.equal(v.preset_1_name, 'Walk-in'); assert.equal(v.auto_take, 'ON'); assert.equal(v.selection, 'S1,S3');
  const ids = L.variableDefinitions(STATE).map((d) => d.variableId);
  assert.ok(ids.includes('preset_2_name') && ids.includes('last_preset_name'));
  assert.equal(L.variableValues(null).last_preset_name, '');
});

test('button presets: one per app preset plus transport and destinations', () => {
  const p = L.buttonPresets(STATE);
  assert.ok(p.preset_1 && p.preset_2 && p.take && p.cut && p.auto_take && p.dest_S1 && p.dest_A1);
  assert.deepEqual(p.preset_2.steps[0].down[0], { actionId: 'recall_preset', options: { preset: 2 } });
  assert.deepEqual(p.preset_2.feedbacks.map((f) => f.feedbackId), ['preset_pvw', 'preset_pgm']);
  assert.equal(p.preset_1.style.bgcolor, L.rgb(40, 40, 40));
  assert.notEqual(L.presetSignature(STATE), L.presetSignature({ ...STATE, presets: [...STATE.presets, { number: 3, name: 'x' }] }));
});

test('AppApi talks to the app endpoints', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { seen.push([req.method, req.url, b]); res.writeHead(req.url.includes('99') ? 400 : 200, { 'Content-Type': 'application/json' }); res.end(req.url.includes('99') ? '{"error":"No preset 99"}' : JSON.stringify(STATE)); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const api = new AppApi('127.0.0.1', srv.address().port);
  try {
    assert.equal((await api.state()).lastRecalled.name, 'Wide');
    await api.recall(2); await api.take(); await api.cut(); await api.toggleDestination('A1'); await api.autoTake(); await api.autoTake(true);
    await assert.rejects(api.recall(99), /No preset 99/);
    assert.deepEqual(seen.map((s) => `${s[0]} ${s[1]} ${s[2]}`), [
      'GET /api/state ', 'POST /api/presets/2/recall ', 'POST /api/take ', 'POST /api/cut ',
      'POST /api/destinations/A1/toggle ', 'POST /api/autotake {}', 'POST /api/autotake {"value":true}', 'POST /api/presets/99/recall ',
    ]);
  } finally { await new Promise((r) => srv.close(r)); }
});

// 0.4.0: tiles can be swapped/moved in the app; the per-preset variables follow the TILE number.
test('0.4.0 preset variables follow the tile after a swap or move, emptied tiles say so', () => {
  const before = { presets: [{ number: 1, name: 'Walk-in' }, { number: 2, name: 'Wide', screens: [] }] };
  const v1 = L.variableValues(before);
  assert.equal(v1.preset_1_name, 'Walk-in'); assert.equal(v1.preset_2_name, 'Wide');
  assert.equal(v1.preset_24_name, '24 (empty)', 'all 24 grid tiles exist as variables');
  // swap 1 <-> 2: the numbers swap, so the "preset 1" button now shows/recalls Wide
  const swapped = { presets: [{ number: 1, name: 'Wide' }, { number: 2, name: 'Walk-in' }] };
  const v2 = L.variableValues(swapped);
  assert.equal(v2.preset_1_name, 'Wide'); assert.equal(v2.preset_2_name, 'Walk-in');
  // move 2 -> 30: tile 2 is empty, 30 exists, defs grow to 30 so no button is left with an undefined variable
  const moved = { presets: [{ number: 1, name: 'Walk-in' }, { number: 30, name: 'Wide' }] };
  const v3 = L.variableValues(moved);
  assert.equal(v3.preset_2_name, '2 (empty)'); assert.equal(v3.preset_2_summary, ''); assert.equal(v3.preset_30_name, 'Wide');
  const ids = L.variableDefinitions(moved).map((d) => d.variableId);
  for (const n of [1, 2, 24, 30]) { assert.ok(ids.includes(`preset_${n}_name`), n); assert.ok(ids.includes(`preset_${n}_summary`), n); }
  assert.notEqual(L.presetSignature(before), L.presetSignature(swapped), 'a swap refreshes the definitions');
});

test('0.4.0 backup group name variables use the label from the device', () => {
  const st = { live: { backup: { groups: [{ group: 1, label: 'MEDIA BU' }, { group: 3, label: '' }] } } };
  const v = L.variableValues(st);
  assert.equal(v.backup_group_1_name, 'MEDIA BU'); assert.equal(v.backup_group_3_name, 'Group 3');
  assert.equal(v.backup_group_2_name, undefined);
  const ids = L.variableDefinitions(st).map((d) => d.variableId);
  assert.ok(ids.includes('backup_group_1_name')); assert.ok(!ids.includes('backup_group_2_name'));
  assert.notEqual(L.presetSignature(st), L.presetSignature({ live: { backup: { groups: [{ group: 1, label: 'RENAMED' }] } } }));
});
