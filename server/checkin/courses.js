const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, 'courses.json');

let config = null;

function validateCourseConfig(course, cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') {
    return [`${course}: config must be an object`];
  }
  if (!cfg.course_code || typeof cfg.course_code !== 'string') {
    errors.push(`${course}.course_code is required and must be a string`);
  }
  if (!cfg.identity_mode || typeof cfg.identity_mode !== 'string') {
    errors.push(`${course}.identity_mode is required and must be a string`);
  }
  if (!cfg.email_domain_hint || typeof cfg.email_domain_hint !== 'string') {
    errors.push(`${course}.email_domain_hint is required and must be a string`);
  }
  if (!cfg.course_end_date || typeof cfg.course_end_date !== 'string' || Number.isNaN(Date.parse(cfg.course_end_date))) {
    errors.push(`${course}.course_end_date is required and must be a parseable date string`);
  }
  if (!Number.isInteger(cfg.retention_days_after_end) || cfg.retention_days_after_end < 0) {
    errors.push(`${course}.retention_days_after_end is required and must be a non-negative integer`);
  }
  if (typeof cfg.allow_embed !== 'boolean') {
    errors.push(`${course}.allow_embed is required and must be a boolean`);
  }
  return errors;
}

function load(filePath) {
  const targetPath = filePath || process.env.CHECKIN_COURSES_FILE || DEFAULT_PATH;
  const raw = fs.readFileSync(targetPath, 'utf8');
  const data = JSON.parse(raw);

  const allErrors = [];
  Object.entries(data).forEach(([course, cfg]) => {
    allErrors.push(...validateCourseConfig(course, cfg));
  });
  if (allErrors.length > 0) {
    throw new Error(`Course config validation failed:\n${allErrors.join('\n')}`);
  }

  config = data;
  return config;
}

function ensureLoaded() {
  if (!config) load();
  return config;
}

function getCourseConfig(course) {
  ensureLoaded();
  return config[course] || null;
}

function getAllCourseConfigs() {
  ensureLoaded();
  return config;
}

module.exports = { load, ensureLoaded, getCourseConfig, getAllCourseConfigs };
