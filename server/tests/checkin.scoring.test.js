const { scoreItem, scoreAllItems, computeSubscaleScores, isStraightline } = require('../checkin/scoring');

const instrument = require('../checkin/instruments/AL.json');

// AL.json (the real, deployed AELS-based instrument) has zero reverse-scored
// items by design -- see its own psychometric_note. It can't exercise
// reverse-scoring behavior, so this tiny synthetic instrument keeps that
// coverage independent of whatever the real instrument's content happens to
// contain.
const reverseItemInstrument = {
  subscales: [
    {
      id: 'synthetic',
      items: [
        { id: 'S01', reverse: false },
        { id: 'S02', reverse: true },
      ],
    },
  ],
};

function allSevens() {
  const answers = {};
  instrument.subscales.forEach((s) => s.items.forEach((item) => { answers[item.id] = 7; }));
  return answers;
}

describe('scoreItem', () => {
  test('returns the raw value for a non-reverse item', () => {
    expect(scoreItem(5, false)).toBe(5);
  });

  test('returns 8 minus the raw value for a reverse item', () => {
    expect(scoreItem(5, true)).toBe(3);
    expect(scoreItem(1, true)).toBe(7);
    expect(scoreItem(7, true)).toBe(1);
  });
});

describe('scoreAllItems', () => {
  test('returns one row per item with raw and scored values', () => {
    const answers = allSevens();
    const rows = scoreAllItems(instrument, answers);
    expect(rows).toHaveLength(20);
    const al01 = rows.find((r) => r.item_id === 'AL01');
    expect(al01).toEqual({ item_id: 'AL01', raw_value: 7, scored_value: 7 }); // not reverse
  });

  test('scores a reverse item as 8 minus the raw value', () => {
    const rows = scoreAllItems(reverseItemInstrument, { S01: 7, S02: 7 });
    const s01 = rows.find((r) => r.item_id === 'S01');
    const s02 = rows.find((r) => r.item_id === 'S02');
    expect(s01).toEqual({ item_id: 'S01', raw_value: 7, scored_value: 7 }); // not reverse
    expect(s02).toEqual({ item_id: 'S02', raw_value: 7, scored_value: 1 }); // reverse
  });
});

describe('computeSubscaleScores', () => {
  test('computes the mean scored value per subscale', () => {
    const answers = allSevens();
    const scores = computeSubscaleScores(instrument, answers);
    // sensing subscale: all 5 items are non-reverse in the real AL.json, so
    // every raw 7 scores as 7; mean = 7
    const sensing = scores.find((s) => s.subscale_id === 'sensing');
    expect(sensing.mean).toBe(7);
    expect(sensing.n_items).toBe(5);
  });

  test('accounts for reverse-scored items in the subscale mean', () => {
    const scores = computeSubscaleScores(reverseItemInstrument, { S01: 7, S02: 7 });
    // S01 is not reverse (scores 7), S02 is reverse (scores 8-7=1); mean = (7+1)/2 = 4
    const synthetic = scores.find((s) => s.subscale_id === 'synthetic');
    expect(synthetic.mean).toBe(4);
    expect(synthetic.n_items).toBe(2);
  });

  test('returns one entry per subscale', () => {
    const scores = computeSubscaleScores(instrument, allSevens());
    expect(scores).toHaveLength(4);
  });
});

describe('isStraightline', () => {
  test('is true when every item has the same raw value', () => {
    expect(isStraightline(instrument, allSevens())).toBe(true);
  });

  test('is false when at least one item differs', () => {
    const answers = allSevens();
    answers.AL10 = 3;
    expect(isStraightline(instrument, answers)).toBe(false);
  });
});
