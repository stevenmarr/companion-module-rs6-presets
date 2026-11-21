'use strict';
// Mock Control Center servers for the unit tests (127.0.0.1, port 0: a fresh port each time).
// Some test machines (IDE or sandbox port forwarding, preview probes) poke every new listening port with
// GET / or GET /favicon.ico to see whether it is a web page. That traffic comes from outside the test, at any
// moment, and landed in the request logs that tests compare exactly (Grok Build, 0.15.0: an extra "GET /").
// The module never asks for anything outside /api/ (every AppApi route is /api/...), so those requests are
// answered 404 here and never reach the test's handler. live.test.js fakeApp has done this since 0.2.0.
const http = require('http');

const stray = (req) => !String(req.url || '').startsWith('/api/');

function mockApp(handler) {
  return http.createServer((req, res) => {
    if (stray(req)) { req.resume(); res.writeHead(404); res.end(); return; }
    handler(req, res);
  });
}

module.exports = { mockApp, stray };
