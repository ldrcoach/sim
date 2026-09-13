function scoreItem(rawValue, reverse) {
  return reverse ? 8 - rawValue : rawValue;
}

function scoreAllItems(instrument, answers) {
  const allItems = instrument.subscales.flatMap((s) => s.items);
  return allItems.map((item) => ({
    item_id: item.id,
    raw_value: answers[item.id],
    scored_value: scoreItem(answers[item.id], item.reverse),
  }));
}

function computeSubscaleScores(instrument, answers) {
  return instrument.subscales.map((s) => {
    const scored = s.items.map((item) => scoreItem(answers[item.id], item.reverse));
    const mean = scored.reduce((sum, v) => sum + v, 0) / scored.length;
    return { subscale_id: s.id, mean: Math.round(mean * 100) / 100, n_items: scored.length };
  });
}

function isStraightline(instrument, answers) {
  const allItems = instrument.subscales.flatMap((s) => s.items);
  const values = allItems.map((item) => answers[item.id]);
  return values.every((v) => v === values[0]);
}

module.exports = { scoreItem, scoreAllItems, computeSubscaleScores, isStraightline };
