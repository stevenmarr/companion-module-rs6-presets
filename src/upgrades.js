'use strict';
// 0.13.0: a connection made before 0.12.0 (or moved from rs6-presets) has no deck_surfaces in its saved config, so
// Companion's settings showed the field empty. The module already treats missing / empty as Stream Deck + XL; this
// writes that default into the config so the setting shows what is used. Also sets legacy_presets to "show".
function deckDefaults(context, props) {
  const config = props && props.config ? { ...props.config } : null;
  let changed = false;
  if (config) {
    const raw = config.deck_surfaces;
    if (!(Array.isArray(raw) ? raw.length : typeof raw === 'string' && raw.trim())) { config.deck_surfaces = ['plusxl']; changed = true; }
    if (config.legacy_presets !== 'show' && config.legacy_presets !== 'hide') { config.legacy_presets = 'show'; changed = true; }
  }
  return { updatedConfig: changed ? config : null, updatedActions: [], updatedFeedbacks: [] };
}

module.exports = [deckDefaults];
