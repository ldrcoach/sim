const express = require('express');
const rateLimit = require('express-rate-limit');
const instrumentLoader = require('./instrumentLoader');
const identity = require('./identity');
const completionCode = require('./completionCode');
const scoring = require('./scoring');
const checkinDb = require('./db');

const router = express.Router();

router.use(express.json({ limit: '64kb' }));

const checkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});
router.use(checkinLimiter);

function requireDb(req, res, next) {
  if (!checkinDb.isAvailable()) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PHASES = ['baseline', 'debrief'];

router.get('/instrument/:course/:module/:phase', (req, res) => {
  const { course, phase } = req.params;
  const moduleNum = Number(req.params.module);

  if (!VALID_PHASES.includes(phase)) {
    return res.status(400).json({ error: 'phase must be "baseline" or "debrief"' });
  }
  if (!Number.isInteger(moduleNum)) {
    return res.status(400).json({ error: 'module must be an integer' });
  }

  const view = instrumentLoader.getPublicView(course, moduleNum, phase);
  if (!view) {
    return res.status(404).json({ error: 'Instrument not found' });
  }
  res.json(view);
});

router.post('/responses', requireDb, async (req, res) => {
  try {
    const { course, phase, identity: ident, started_at, answers, extras } = req.body;
    const moduleNum = Number(req.body.module);

    if (!course || typeof course !== 'string') {
      return res.status(400).json({ error: 'course is required' });
    }
    if (!Number.isInteger(moduleNum)) {
      return res.status(400).json({ error: 'module must be an integer' });
    }
    if (!VALID_PHASES.includes(phase)) {
      return res.status(400).json({ error: 'phase must be "baseline" or "debrief"' });
    }
    if (!ident || typeof ident.email !== 'string' || !EMAIL_RE.test(ident.email)) {
      return res.status(400).json({ error: 'identity.email is required and must be a valid email' });
    }
    if (!started_at || typeof started_at !== 'string') {
      return res.status(400).json({ error: 'started_at is required' });
    }
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object is required' });
    }

    const instrument = instrumentLoader.getInstrument(course, moduleNum);
    if (!instrument) {
      return res.status(404).json({ error: 'Instrument not found' });
    }

    const allItems = instrument.subscales.flatMap((s) => s.items);
    for (const item of allItems) {
      const v = answers[item.id];
      if (!Number.isInteger(v) || v < 1 || v > instrument.scale.points) {
        return res.status(400).json({
          error: `answers.${item.id} must be an integer between 1 and ${instrument.scale.points}`,
        });
      }
    }
    const extraKeys = Object.keys(answers).filter((k) => !allItems.some((item) => item.id === k));
    if (extraKeys.length > 0) {
      return res.status(400).json({ error: `unknown item ids in answers: ${extraKeys.join(', ')}` });
    }

    if (phase === 'debrief') {
      if (!extras || typeof extras !== 'object') {
        return res.status(400).json({ error: 'extras is required for debrief submissions' });
      }
      const pxItems = instrument.debrief_extras.post_experience.items;
      const pxAnswers = extras.post_experience || {};
      for (const item of pxItems) {
        const v = pxAnswers[item.id];
        if (!Number.isInteger(v) || v < 1 || v > instrument.scale.points) {
          return res.status(400).json({
            error: `extras.post_experience.${item.id} must be an integer between 1 and ${instrument.scale.points}`,
          });
        }
      }
      const openItems = instrument.debrief_extras.open_ended;
      const openAnswers = extras.open_ended || {};
      for (const q of openItems) {
        const v = openAnswers[q.id];
        if (typeof v !== 'string' || v.trim().length < 40) {
          return res.status(400).json({
            error: `extras.open_ended.${q.id} must be a string of at least 40 characters`,
          });
        }
      }
    }

    const participantId = identity.deriveParticipantId(ident.email, process.env.CHECKIN_HMAC_SECRET);
    const emailEncrypted = identity.encryptEmail(ident.email, process.env.CHECKIN_AES_KEY);
    await checkinDb.upsertParticipant(participantId, emailEncrypted, 'email');

    const supersedes = await checkinDb.findLatestResponseId(participantId, course, moduleNum, phase);
    const straightlineFlag = scoring.isStraightline(instrument, answers);
    const scoredItems = scoring.scoreAllItems(instrument, answers);
    const subscaleScores = scoring.computeSubscaleScores(instrument, answers);
    const submittedAt = new Date().toISOString();

    const code = completionCode.generateCompletionCode({
      abbrev: instrument.abbrev,
      module: moduleNum,
      phase,
      course,
      participantId,
      submittedAt,
      secret: process.env.CHECKIN_HMAC_SECRET,
    });

    await checkinDb.insertResponse({
      course,
      module: moduleNum,
      phase,
      participantId,
      instrumentVersion: instrument.version,
      startedAt: started_at,
      straightlineFlag,
      supersedes,
      completionCode: code,
      itemsJson: answers,
      extrasJson: phase === 'debrief' ? extras : null,
      scoredItems,
      subscaleScores,
    });

    res.json({ completion_code: code, subscale_means: subscaleScores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
