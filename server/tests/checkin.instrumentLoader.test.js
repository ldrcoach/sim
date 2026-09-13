const path = require('path');
const { validateInstrument } = require('../checkin/instrumentValidator');

describe('AL.json fixture', () => {
  test('the Module 4 fixture instrument passes the validator', () => {
    const data = require('../checkin/instruments/AL.json');
    const { valid, errors } = validateInstrument(data);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });
});

const fs = require('fs');
const os = require('os');

describe('instrumentLoader', () => {
  let loader;
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    loader = require('../checkin/instrumentLoader');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkin-instruments-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('loads a valid instrument and serves it via getInstrument', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    const instrument = loader.getInstrument('OBLD500', 4);
    expect(instrument).not.toBeNull();
    expect(instrument.abbrev).toBe('AL');
    expect(instrument.subscales.flatMap((s) => s.items)).toHaveLength(20);
  });

  test('getInstrument returns null for an unknown course/module', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    expect(loader.getInstrument('OBLD500', 99)).toBeNull();
  });

  test('throws with all validation errors when a file is invalid', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'BAD.json'),
      JSON.stringify({ course: 'OBLD500', module: 1, abbrev: 'BAD', topic: 'Bad', version: '1' })
    );
    expect(() => loader.load(tmpDir)).toThrow(/BAD\.json/);
  });

  test('getPublicView strips reverse flags for baseline', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    const view = loader.getPublicView('OBLD500', 4, 'baseline');
    expect(view.subscales[0].items[0]).toEqual({ id: 'AL01', text: expect.any(String) });
    expect(view.debrief_extras).toBeUndefined();
  });

  test('getPublicView includes debrief_extras only for debrief', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    const view = loader.getPublicView('OBLD500', 4, 'debrief');
    expect(view.debrief_extras.post_experience.items).toHaveLength(5);
    expect(view.debrief_extras.open_ended).toHaveLength(3);
  });

  test('getPublicView returns null for an unknown instrument', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    expect(loader.getPublicView('OBLD500', 99, 'baseline')).toBeNull();
  });

  test('reload re-reads the directory', () => {
    loader.load(path.join(__dirname, '..', 'checkin', 'instruments'));
    expect(loader.getInstrument('OBLD500', 4)).not.toBeNull();
    loader.reload(tmpDir); // empty dir
    expect(loader.getInstrument('OBLD500', 4)).toBeNull();
  });
});
