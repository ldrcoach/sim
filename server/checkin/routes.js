const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const instrumentLoader = require('./instrumentLoader');
const identity = require('./identity');
const completionCode = require('./completionCode');
const scoring = require('./scoring');
const checkinDb = require('./db');
const courses = require('./courses');

const router = express.Router();

const checkinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});

function requireDb(req, res, next) {
  if (!checkinDb.isAvailable()) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  next();
}

function isValidEmail(email) {
  if (typeof email !== 'string' || email.length === 0 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const atIndex = email.indexOf('@');
  if (atIndex <= 0 || atIndex !== email.lastIndexOf('@')) return false; // exactly one @, not at the start
  const domain = email.slice(atIndex + 1);
  const dotIndex = domain.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === domain.length - 1) return false; // dot present, not at domain's edges
  return true;
}

function isValidKey(key) {
  if (typeof key !== 'string') return false;
  const trimmed = key.trim();
  return trimmed.length >= 3 && trimmed.length <= 100;
}
const VALID_PHASES = ['baseline', 'debrief'];

router.get('/instrument/:course/:module/:phase', checkinLimiter, (req, res) => {
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

  const courseConfig = courses.getCourseConfig(course);
  view.identity_mode = courseConfig ? courseConfig.identity_mode : 'email';
  view.email_domain_hint = courseConfig ? courseConfig.email_domain_hint : null;

  res.json(view);
});

router.post('/responses', checkinLimiter, express.json({ limit: '64kb' }), requireDb, async (req, res) => {
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
    if (!started_at || typeof started_at !== 'string') {
      return res.status(400).json({ error: 'started_at is required' });
    }
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object is required' });
    }

    const courseConfig = courses.getCourseConfig(course);
    const identityMode = courseConfig ? courseConfig.identity_mode : 'email';

    if (identityMode === 'email') {
      if (!ident || !isValidEmail(ident.email)) {
        return res.status(400).json({ error: 'identity.email is required and must be a valid email' });
      }
    } else if (identityMode === 'key') {
      if (!ident || !isValidKey(ident.key)) {
        return res.status(400).json({ error: 'identity.key is required and must be between 3 and 100 characters' });
      }
    } else if (identityMode !== 'none') {
      return res.status(501).json({ error: `identity_mode "${identityMode}" is not yet implemented` });
    }
    // 'none' mode requires no identity field at all -- any submitted `identity` is ignored.

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

    let participantId;
    let emailEncrypted = null;
    if (identityMode === 'email') {
      participantId = identity.deriveParticipantId(ident.email, process.env.CHECKIN_HMAC_SECRET);
      emailEncrypted = identity.encryptEmail(ident.email, process.env.CHECKIN_AES_KEY);
    } else if (identityMode === 'key') {
      // deriveParticipantId is generic over any string input (trim + lowercase,
      // then HMAC) -- the same function works for a key exactly as it does for
      // an email, with no changes needed to identity.js.
      participantId = identity.deriveParticipantId(ident.key, process.env.CHECKIN_HMAC_SECRET);
    } else {
      // 'none': no persistent identity, no pairing across submissions -- a
      // fresh random id every time. checkin_participants still needs a row
      // (checkin_responses.participant_id is a NOT NULL foreign key to it).
      participantId = crypto.randomUUID();
    }
    await checkinDb.upsertParticipant(participantId, emailEncrypted, identityMode);

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

    let baselineComparison;
    if (phase === 'debrief') {
      const baselineScores = await checkinDb.findLatestSubscaleScores(participantId, course, moduleNum, 'baseline');
      if (baselineScores) {
        baselineComparison = subscaleScores.map((debriefScore) => {
          const baselineScore = baselineScores.find((b) => b.subscale_id === debriefScore.subscale_id);
          return {
            subscale_id: debriefScore.subscale_id,
            baseline_mean: baselineScore ? baselineScore.mean : null,
            debrief_mean: debriefScore.mean,
            delta: baselineScore ? Math.round((debriefScore.mean - baselineScore.mean) * 100) / 100 : null,
          };
        });
      }
    }

    res.json({
      completion_code: code,
      subscale_means: subscaleScores,
      ...(baselineComparison ? { baseline_comparison: baselineComparison } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
