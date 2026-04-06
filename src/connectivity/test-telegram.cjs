// Test Telegram notification without scraping
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const Notifier = require('../notifier');
const JobMatcher = require('../matcher');

// Sample jobs from history
const sampleJobs = [
  {
    id: '1',
    source: 'LinkedIn',
    title: 'Senior AI Engineer',
    company: 'TechCorp',
    location: 'Remote',
    link: 'https://linkedin.com/jobs/1',
    description: 'We are looking for an AI engineer with experience in RAG, Langchain, and ML',
    matchScore: 8,
    roleCategory: 'AI Engineer'
  },
  {
    id: '2',
    source: 'LinkedIn',
    title: 'Frontend React Developer',
    company: 'StartupXYZ',
    location: 'Remote',
    link: 'https://linkedin.com/jobs/2',
    description: 'React developer needed with TypeScript experience',
    matchScore: 6,
    roleCategory: 'Frontend Engineer'
  },
  {
    id: '3',
    source: 'LinkedIn',
    title: 'Mobile React Native Developer',
    company: 'AppWorks',
    location: 'Australia (Remote)',
    link: 'https://linkedin.com/jobs/3',
    description: 'React Native mobile developer for iOS and Android',
    matchScore: 5,
    roleCategory: 'Mobile Engineer'
  },
  {
    id: '4',
    source: 'LinkedIn',
    title: 'Backend Engineer - Spring Boot',
    company: 'Enterprise Inc',
    location: 'Remote',
    link: 'https://linkedin.com/jobs/4',
    description: 'Backend engineer with Spring Boot and AWS experience',
    matchScore: 7,
    roleCategory: 'Backend Engineer'
  }
];

// Load profile
const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'profile.json'), 'utf8'));

// Match jobs
const matcher = new JobMatcher(profile);
const matchedJobs = matcher.matchJobs(sampleJobs);
const summary = matcher.generateSummary(matchedJobs);

console.log('Matched jobs:', matchedJobs.length);
console.log('Summary:', summary);

// Test Telegram notification
async function testNotifier() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!chatId) {
    console.log('❌ TELEGRAM_CHAT_ID not set in .env');
    return;
  }
  
  console.log('✓ TELEGRAM_CHAT_ID found:', chatId);
  
  const notifier = new Notifier(chatId);
  
  try {
    console.log('📤 Sending test notification...');
    await notifier.sendNotification(matchedJobs, summary);
    console.log('✅ Telegram notification sent successfully!');
  } catch (error) {
    console.error('❌ Telegram notification failed:', error.message);
  }
}

testNotifier();
