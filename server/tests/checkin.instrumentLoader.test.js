const { validateInstrument } = require('../checkin/instrumentValidator');

describe('AL.json fixture', () => {
  test('the Module 4 fixture instrument passes the validator', () => {
    const data = require('../checkin/instruments/AL.json');
    const { valid, errors } = validateInstrument(data);
    expect(errors).toEqual([]);
    expect(valid).toBe(true);
  });
});
