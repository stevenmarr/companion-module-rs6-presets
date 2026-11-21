'use strict';
// Control Center 0.33.0+ starts with an empty desk, even in --mock mode, so the device mocks stay idle until a system
// is put on the desk (POST /api/sys/armed). The end-to-end tests arm the systems they drive. Resolves true once every
// system answered 200, or 404 from an older app that arms everything by itself; false while the app is not up yet.
module.exports = async function armSystems(port, systems) {
  try {
    for (const system of systems) {
      const res = await fetch(`http://127.0.0.1:${port}/api/sys/armed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, on: true }) });
      await res.arrayBuffer();
      if (res.status === 404) return true;
      if (!res.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
};
