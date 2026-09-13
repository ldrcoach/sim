const { scoreItem, scoreAllItems, computeSubscaleScores, isStraightline } = require('../checkin/scoring');

const instrument = require('../checkin/instruments/AL.json');

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
    const al05 = rows.find((r) => r.item_id === 'AL05');
    expect(al05).toEqual({ item_id: 'AL05', raw_value: 7, scored_value: 1 }); // reverse
  });
});

describe('computeSubscaleScores', () => {
  test('computes the mean scored value per subscale', () => {
    const answers = allSevens();
    const scores = computeSubscaleScores(instrument, answers);
    // sensing subscale: AL01-04 are 7 (not reverse), AL05 is reverse so scores 1
    // mean = (7+7+7+7+1)/5 = 5.8
    const sensing = scores.find((s) => s.subscale_id === 'sensing');
    expect(sensing.mean).toBe(5.8);
    expect(sensing.n_items).toBe(5);
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
