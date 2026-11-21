'use strict';
// Where the end-to-end tests find a Control Center app checkout: RS6_APP_DIR (or CC_APP_DIR), else a sibling folder
// named after the app's repository (performance-video-control), else the app's older local folder name.
const fs = require('fs');
const path = require('path');

const parent = path.join(__dirname, '..', '..');
const candidates = ['performance-video-control', 'Performance-Video-Control', 'rs6-presets'].map((d) => path.join(parent, d));
module.exports = process.env.RS6_APP_DIR || process.env.CC_APP_DIR || candidates.find((d) => fs.existsSync(path.join(d, 'server.js'))) || candidates[0];
