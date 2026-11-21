'use strict';
// Upgrade scripts. Companion runs each script once per connection, in order, and remembers how far it got, so never
// reorder or remove one; add new ones at the end.

// 0.13.0: a connection made before 0.12.0 (or moved over from the module's first id) has no deck_surfaces in its
// saved config, so Companion's settings showed the field empty. The module already treats missing / empty as
// Stream Deck + XL; this writes that default into the config so the setting shows what is used.
function deckDefaults(context, props) {
  const config = props && props.config ? { ...props.config } : null;
  let changed = false;
  if (config) {
    const raw = config.deck_surfaces;
    if (!(Array.isArray(raw) ? raw.length : typeof raw === 'string' && raw.trim())) { config.deck_surfaces = ['plusxl']; changed = true; }
  }
  return { updatedConfig: changed ? config : null, updatedActions: [], updatedFeedbacks: [] };
}

// 0.14.0: Control Center presets only. The setting that showed or hid the per-system sections (legacy_presets) is
// gone, so drop it from the saved config. Nothing else changes: action, feedback and variable ids are the same, so
// buttons already placed (from those sections too) keep working.
function ccOnly(context, props) {
  const config = props && props.config ? { ...props.config } : null;
  if (!config || !Object.prototype.hasOwnProperty.call(config, 'legacy_presets')) return { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] };
  delete config.legacy_presets;
  return { updatedConfig: config, updatedActions: [], updatedFeedbacks: [] };
}

module.exports = [deckDefaults, ccOnly];
