const { validateInstrument } = require('../checkin/instrumentValidator');

function validInstrument(overrides = {}) {
  const base = {
    course: 'OBLD500',
    module: 4,
    abbrev: 'AL',
    topic: 'Active Listening',
    version: 'dev-fixture-v1',
    scale: {
      points: 7,
      labels: [
        'Strongly Disagree', 'Disagree', 'Somewhat Disagree',
        'Neither Agree nor Disagree', 'Somewhat Agree', 'Agree', 'Strongly Agree',
      ],
    },
    intro: { baseline: 'Baseline intro text.', debrief: 'Debrief intro text.' },
    subscales: [
      {
        id: 'sensing', name: 'Sensing', help: 'Help text.',
        items: [
          { id: 'AL01', text: 'Item 1', reverse: false },
          { id: 'AL02', text: 'Item 2', reverse: false },
          { id: 'AL03', text: 'Item 3', reverse: false },
          { id: 'AL04', text: 'Item 4', reverse: false },
          { id: 'AL05', text: 'Item 5', reverse: true },
        ],
      },
      {
        id: 'attending', name: 'Attending', help: 'Help text.',
        items: [
          { id: 'AL06', text: 'Item 6', reverse: false },
          { id: 'AL07', text: 'Item 7', reverse: false },
          { id: 'AL08', text: 'Item 8', reverse: true },
          { id: 'AL09', text: 'Item 9', reverse: false },
          { id: 'AL10', text: 'Item 10', reverse: false },
        ],
      },
      {
        id: 'processing', name: 'Processing', help: 'Help text.',
        items: [
          { id: 'AL11', text: 'Item 11', reverse: false },
          { id: 'AL12', text: 'Item 12', reverse: false },
          { id: 'AL13', text: 'Item 13', reverse: false },
          { id: 'AL14', text: 'Item 14', reverse: false },
          { id: 'AL15', text: 'Item 15', reverse: false },
        ],
      },
      {
        id: 'responding', name: 'Responding', help: 'Help text.',
        items: [
          { id: 'AL16', text: 'Item 16', reverse: false },
          { id: 'AL17', text: 'Item 17', reverse: false },
          { id: 'AL18', text: 'Item 18', reverse: false },
          { id: 'AL19', text: 'Item 19', reverse: false },
          { id: 'AL20', text: 'Item 20', reverse: false },
        ],
      },
    ],
    debrief_extras: {
      post_experience: {
        name: 'Post-Experience Reflection',
        items: [
          { id: 'AL_PX1', text: 'PX 1', reverse: false },
          { id: 'AL_PX2', text: 'PX 2', reverse: false },
          { id: 'AL_PX3', text: 'PX 3', reverse: false },
          { id: 'AL_PX4', text: 'PX 4', reverse: false },
          { id: 'AL_PX5', text: 'PX 5', reverse: false },
        ],
      },
      open_ended: [
        { id: 'AL_Q1', prompt: 'Prompt 1' },
        { id: 'AL_Q2', prompt: 'Prompt 2' },
        { id: 'AL_Q3', prompt: 'Prompt 3' },
      ],
    },
    completion: { baseline: 'Baseline done.', debrief: 'Debrief done.' },
  };
  return { ...base, ...overrides };
}

describe('validateInstrument', () => {
  test('accepts a fully valid instrument', () => {
    const { valid, errors } = validateInstrument(validInstrument());
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  test('rejects an instrument with 19 items', () => {
    const data = validInstrument();
    data.subscales[3].items.pop(); // now 19 items
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('exactly 20 items'))).toBe(true);
  });

  test('rejects an instrument with fewer than 2 reverse-scored items', () => {
    const data = validInstrument();
    data.subscales[0].items[4].reverse = false; // was the only other reverse item besides AL08
    data.subscales[1].items[2].reverse = false;
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('at least 2 reverse-scored items'))).toBe(true);
  });

  test('accepts an instrument with no reverse-scored items when min_reverse_items is 0', () => {
    const data = validInstrument({ min_reverse_items: 0, psychometric_note: 'Positively keyed adaptation.' });
    data.subscales[0].items[4].reverse = false;
    data.subscales[1].items[2].reverse = false;
    const { valid, errors } = validateInstrument(data);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });

  test('rejects a negative min_reverse_items', () => {
    const data = validInstrument({ min_reverse_items: -1, psychometric_note: 'Some note.' });
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('min_reverse_items') && e.includes('non-negative'))).toBe(true);
  });

  test('rejects min_reverse_items without a psychometric_note explaining the override', () => {
    const data = validInstrument({ min_reverse_items: 0 });
    data.subscales[0].items[4].reverse = false;
    data.subscales[1].items[2].reverse = false;
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('psychometric_note'))).toBe(true);
  });

  test('rejects duplicate item ids', () => {
    const data = validInstrument();
    data.subscales[1].items[0].id = 'AL01'; // duplicates subscale 0's first item
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('unique'))).toBe(true);
  });

  test('rejects a scale that is not 7 points', () => {
    const data = validInstrument();
    data.scale.points = 5;
    data.scale.labels = data.scale.labels.slice(0, 5);
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('scale.points'))).toBe(true);
  });

  test('rejects a debrief_extras.post_experience block that is not 5 items', () => {
    const data = validInstrument();
    data.debrief_extras.post_experience.items.pop();
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('post_experience'))).toBe(true);
  });

  test('rejects an open_ended block that is not 3 prompts', () => {
    const data = validInstrument();
    data.debrief_extras.open_ended.push({ id: 'AL_Q4', prompt: 'Extra' });
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('open_ended'))).toBe(true);
  });

  test('rejects an em dash anywhere in the text', () => {
    const data = validInstrument();
    data.subscales[0].items[0].text = 'This has an em dash — right there.';
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('em dash'))).toBe(true);
  });

  test('rejects a double hyphen anywhere in the text', () => {
    const data = validInstrument();
    data.topic = 'Active Listening -- Module 4';
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('double hyphen'))).toBe(true);
  });

  test('rejects "Bodyswaps" and "grant" case-insensitively', () => {
    const data = validInstrument();
    data.intro.baseline = 'Funded by the BODYSWAPS Immersive Learning Grant.';
    const { valid, errors } = validateInstrument(data);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('Bodyswaps'))).toBe(true);
    expect(errors.some((e) => e.includes('grant'))).toBe(true);
  });

  test('accumulates multiple errors in one pass rather than failing fast', () => {
    const data = validInstrument();
    data.subscales[3].items.pop(); // 19 items
    data.scale.points = 5; // bad scale
    const { errors } = validateInstrument(data);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});
