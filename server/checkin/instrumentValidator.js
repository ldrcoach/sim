const FORBIDDEN_PATTERNS = [
  { name: 'em dash', regex: /—/ },
  { name: 'double hyphen', regex: /--/ },
  { name: '"Bodyswaps"', regex: /bodyswaps/i },
  { name: '"grant"', regex: /grant/i },
];

function collectTextFields(data) {
  const fields = [];
  const push = (label, value) => {
    if (typeof value === 'string') fields.push({ label, value });
  };

  push('topic', data.topic);
  if (data.intro) {
    push('intro.baseline', data.intro.baseline);
    push('intro.debrief', data.intro.debrief);
  }
  if (data.completion) {
    push('completion.baseline', data.completion.baseline);
    push('completion.debrief', data.completion.debrief);
  }

  (data.subscales || []).forEach((s) => {
    push(`subscale ${s.id}.name`, s.name);
    push(`subscale ${s.id}.help`, s.help);
    (s.items || []).forEach((item) => push(`item ${item.id}.text`, item.text));
  });

  const px = data.debrief_extras && data.debrief_extras.post_experience;
  if (px) {
    push('post_experience.name', px.name);
    (px.items || []).forEach((item) => push(`post_experience item ${item.id}.text`, item.text));
  }
  const openEnded = (data.debrief_extras && data.debrief_extras.open_ended) || [];
  openEnded.forEach((q) => push(`open_ended ${q.id}.prompt`, q.prompt));

  return fields;
}

function validateInstrument(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Instrument must be a JSON object'] };
  }

  if (!data.course || typeof data.course !== 'string') errors.push('course is required and must be a string');
  if (!Number.isInteger(data.module)) errors.push('module is required and must be an integer');
  if (!data.abbrev || typeof data.abbrev !== 'string') errors.push('abbrev is required and must be a string');
  if (!data.topic || typeof data.topic !== 'string') errors.push('topic is required and must be a string');
  if (!data.version || typeof data.version !== 'string') errors.push('version is required and must be a string');

  if (!data.scale || data.scale.points !== 7) {
    errors.push('scale.points must equal 7');
  }
  if (!data.scale || !Array.isArray(data.scale.labels) || data.scale.labels.length !== 7) {
    errors.push('scale.labels must be an array of exactly 7 labels');
  }

  if (!data.intro || typeof data.intro.baseline !== 'string' || typeof data.intro.debrief !== 'string') {
    errors.push('intro.baseline and intro.debrief are both required strings');
  }
  if (!data.completion || typeof data.completion.baseline !== 'string' || typeof data.completion.debrief !== 'string') {
    errors.push('completion.baseline and completion.debrief are both required strings');
  }

  const subscales = Array.isArray(data.subscales) ? data.subscales : [];
  if (subscales.length === 0) errors.push('subscales must be a non-empty array');

  const allItems = [];
  subscales.forEach((s, i) => {
    if (!s.id || typeof s.id !== 'string') errors.push(`subscales[${i}].id is required`);
    if (!s.name || typeof s.name !== 'string') errors.push(`subscales[${i}].name is required`);
    if (!Array.isArray(s.items)) {
      errors.push(`subscales[${i}].items must be an array`);
    } else {
      s.items.forEach((item, j) => {
        if (!item.id || typeof item.id !== 'string') errors.push(`subscales[${i}].items[${j}].id is required`);
        if (!item.text || typeof item.text !== 'string') errors.push(`subscales[${i}].items[${j}].text is required`);
        if (typeof item.reverse !== 'boolean') errors.push(`subscales[${i}].items[${j}].reverse must be a boolean`);
        allItems.push(item);
      });
    }
  });

  if (allItems.length !== 20) {
    errors.push(`instrument must have exactly 20 items across all subscales, found ${allItems.length}`);
  }

  const ids = allItems.map((item) => item.id).filter(Boolean);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    errors.push('item ids must be unique across the instrument');
  }

  // Default minimum of 2 reverse-scored items (acquiescence control). An instrument that adapts a
  // positively keyed validated scale may declare min_reverse_items (for example 0) with a psychometric_note.
  let minReverse = 2;
  if (data.min_reverse_items !== undefined) {
    if (!Number.isInteger(data.min_reverse_items) || data.min_reverse_items < 0) {
      errors.push('min_reverse_items, if present, must be a non-negative integer');
    } else if (!data.psychometric_note || typeof data.psychometric_note !== 'string') {
      errors.push('min_reverse_items requires a psychometric_note explaining the override');
    } else {
      minReverse = data.min_reverse_items;
    }
  }
  const reverseCount = allItems.filter((item) => item.reverse === true).length;
  if (reverseCount < minReverse) {
    errors.push(`instrument must have at least ${minReverse} reverse-scored items, found ${reverseCount}`);
  }

  const px = data.debrief_extras && data.debrief_extras.post_experience;
  if (!px || !Array.isArray(px.items) || px.items.length !== 5) {
    errors.push('debrief_extras.post_experience.items must be an array of exactly 5 items');
  } else {
    px.items.forEach((item, j) => {
      if (!item.id || typeof item.id !== 'string') errors.push(`debrief_extras.post_experience.items[${j}].id is required`);
      if (!item.text || typeof item.text !== 'string') errors.push(`debrief_extras.post_experience.items[${j}].text is required`);
    });
  }

  const openEnded = data.debrief_extras && data.debrief_extras.open_ended;
  if (!Array.isArray(openEnded) || openEnded.length !== 3) {
    errors.push('debrief_extras.open_ended must be an array of exactly 3 prompts');
  } else {
    openEnded.forEach((q, j) => {
      if (!q.id || typeof q.id !== 'string') errors.push(`debrief_extras.open_ended[${j}].id is required`);
      if (!q.prompt || typeof q.prompt !== 'string') errors.push(`debrief_extras.open_ended[${j}].prompt is required`);
    });
  }

  collectTextFields(data).forEach(({ label, value }) => {
    FORBIDDEN_PATTERNS.forEach(({ name, regex }) => {
      if (regex.test(value)) {
        errors.push(`${label} contains forbidden ${name}`);
      }
    });
  });

  return { valid: errors.length === 0, errors };
}

module.exports = { validateInstrument };
