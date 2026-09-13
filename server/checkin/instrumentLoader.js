const fs = require('fs');
const path = require('path');
const { validateInstrument } = require('./instrumentValidator');

const DEFAULT_DIR = path.join(__dirname, 'instruments');

let store = null; // Map "course/module" -> instrument object
let loadedDir = null;

function load(dir) {
  const targetDir = dir || process.env.CHECKIN_INSTRUMENT_DIR || DEFAULT_DIR;
  const files = fs.readdirSync(targetDir).filter((f) => f.endsWith('.json'));
  const nextStore = new Map();
  const allErrors = [];

  for (const file of files) {
    const fullPath = path.join(targetDir, file);
    const raw = fs.readFileSync(fullPath, 'utf8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      allErrors.push(`${file}: invalid JSON (${err.message})`);
      continue;
    }
    const { valid, errors } = validateInstrument(data);
    if (!valid) {
      errors.forEach((e) => allErrors.push(`${file}: ${e}`));
      continue;
    }
    nextStore.set(`${data.course}/${data.module}`, data);
  }

  if (allErrors.length > 0) {
    throw new Error(`Instrument validation failed:\n${allErrors.join('\n')}`);
  }

  store = nextStore;
  loadedDir = targetDir;
  return store;
}

function ensureLoaded() {
  if (!store) load();
  return store;
}

function getInstrument(course, moduleNum) {
  ensureLoaded();
  return store.get(`${course}/${moduleNum}`) || null;
}

function getPublicView(course, moduleNum, phase) {
  if (phase !== 'baseline' && phase !== 'debrief') {
    throw new Error(`Invalid phase: ${phase}. Must be 'baseline' or 'debrief'.`);
  }
  const instrument = getInstrument(course, moduleNum);
  if (!instrument) return null;

  const view = {
    course: instrument.course,
    module: instrument.module,
    abbrev: instrument.abbrev,
    topic: instrument.topic,
    version: instrument.version,
    scale: instrument.scale,
    intro: instrument.intro[phase],
    subscales: instrument.subscales.map((s) => ({
      id: s.id,
      name: s.name,
      help: s.help,
      items: s.items.map((item) => ({ id: item.id, text: item.text })),
    })),
    completion: instrument.completion[phase],
  };

  if (phase === 'debrief') {
    view.debrief_extras = {
      post_experience: {
        name: instrument.debrief_extras.post_experience.name,
        items: instrument.debrief_extras.post_experience.items.map((item) => ({
          id: item.id,
          text: item.text,
        })),
      },
      open_ended: instrument.debrief_extras.open_ended.map((q) => ({ id: q.id, prompt: q.prompt })),
    };
  }

  return view;
}

function reload(dir) {
  store = null;
  return load(dir || loadedDir);
}

module.exports = { load, ensureLoaded, getInstrument, getPublicView, reload };
