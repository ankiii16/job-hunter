// Test email notification without scraping
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const Notifier = require('../notifier');
const JobMatcher = require('../matcher');

function loadJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function deepMerge(base = {}, override = {}) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return Array.isArray(override) ? [...override] : [...(base || [])];
  }

  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    const baseValue = result[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    ) {
      result[key] = deepMerge(baseValue, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// Sample jobs from history
const sampleJobs = [
  {
    id: '1',
    source: 'LinkedIn',
    title: 'Business Intelligence Analyst',
    company: 'DataCorp',
    location: 'Remote',
    link: 'https://linkedin.com/jobs/1',
    description: 'Power BI, DAX, SQL and reporting analytics',
    matchScore: 8,
    roleCategory: 'General'
  },
  {
    id: '2',
    source: 'Seek',
    title: 'Data Analyst',
    company: 'Insights Pty Ltd',
    location: 'Remote',
    link: 'https://seek.com.au/job/2',
    description: 'Python, Pandas, Tableau, SQL',
    matchScore: 7,
    roleCategory: 'General'
  }
];

// Load profile (named profile with legacy fallback)
const configDir = path.join(__dirname, '..', '..', 'config');
const selectedProfile = process.env.JOB_PROFILE || 'default';
const commonConfig = loadJsonIfExists(path.join(configDir, 'common.json')) || {};
const namedProfileConfig = loadJsonIfExists(path.join(configDir, 'profiles', `${selectedProfile}.json`));
const legacyProfileConfig = loadJsonIfExists(path.join(configDir, 'profile.json'));

const profile = namedProfileConfig
  ? deepMerge(commonConfig, namedProfileConfig)
  : deepMerge(commonConfig, legacyProfileConfig || {});

// Match jobs
const matcher = new JobMatcher(profile);
const matchedJobs = matcher.matchJobs(sampleJobs);
const summary = matcher.generateSummary(matchedJobs);

console.log('Matched jobs:', matchedJobs.length);
console.log('Summary:', summary);

async function testEmailNotifier() {
  const email = {
    from: profile?.notifications?.email?.from || process.env.EMAIL_FROM,
    to: profile?.notifications?.email?.to || process.env.EMAIL_TO,
    smtpHost: profile?.notifications?.email?.smtpHost || process.env.SMTP_HOST,
    smtpPort: Number(profile?.notifications?.email?.smtpPort || process.env.SMTP_PORT || 587),
    smtpSecure:
      profile?.notifications?.email?.smtpSecure !== undefined
        ? Boolean(profile?.notifications?.email?.smtpSecure)
        : String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    smtpUser: profile?.notifications?.email?.smtpUser || process.env.SMTP_USER,
    smtpPass: profile?.notifications?.email?.smtpPass || process.env.SMTP_PASS,
    subjectPrefix: profile?.notifications?.email?.subjectPrefix || process.env.EMAIL_SUBJECT_PREFIX || 'Job Hunter'
  };

  const required = ['from', 'to', 'smtpHost', 'smtpUser', 'smtpPass'];
  const missing = required.filter(key => !email[key]);

  if (missing.length > 0) {
    console.log('❌ Email not fully configured');
    console.log(`   Missing: ${missing.join(', ')}`);
    console.log('   Set profile.notifications.email.* for this profile or corresponding .env values');
    return;
  }

  const notifier = new Notifier({
    mode: 'email',
    email
  });

  try {
    console.log(`📤 Sending test email for profile: ${selectedProfile}...`);
    const result = await notifier.sendNotification(matchedJobs, summary);
    if (result?.method === 'email') {
      console.log('✅ Email notification sent successfully!');
    } else {
      console.log('⚠ Email delivery failed; fallback used:', result?.method || 'unknown');
    }
  } catch (error) {
    console.error('❌ Email notification failed:', error.message);
  }
}

testEmailNotifier();
