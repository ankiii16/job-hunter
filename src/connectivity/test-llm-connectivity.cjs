// Test LLM connectivity and notification with dummy job data
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const Notifier = require('../notifier');
const JobMatcher = require('../matcher');
const LLMJobMatcher = require('../llm-matcher');

// Load sample jobs from the attached JSON file
const sampleJobsPath = path.join(__dirname, '..', '..', 'data', 'results', 'jobs-2026-04-06T07-08-39.json');
let sampleJobs = [];

try {
  if (fs.existsSync(sampleJobsPath)) {
    sampleJobs = JSON.parse(fs.readFileSync(sampleJobsPath, 'utf8'));
    console.log(`✓ Loaded ${sampleJobs.length} sample jobs from ${sampleJobsPath}`);
  } else {
    console.log(`⚠ Sample file not found: ${sampleJobsPath}`);
    console.log('Using built-in sample jobs instead...');
    sampleJobs = getBuiltInSamples();
  }
} catch (error) {
  console.error('Error loading sample jobs:', error.message);
  sampleJobs = getBuiltInSamples();
}

// Fallback sample jobs
function getBuiltInSamples() {
  return [
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
      title: 'Backend Engineer - Spring Boot',
      company: 'Enterprise Inc',
      location: 'Geelong, VIC (Remote)',
      link: 'https://linkedin.com/jobs/3',
      description: 'Backend engineer with Spring Boot and AWS experience',
      matchScore: 7,
      roleCategory: 'Backend Engineer'
    }
  ];
}

// Load profile
const profilePath = path.join(__dirname, '..', '..', 'config', 'profile.json');
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

// Match jobs with our matcher
const matcher = new JobMatcher(profile);
let matchedJobs = matcher.matchJobs(sampleJobs);
const summary = matcher.generateSummary(matchedJobs);

console.log(`\n📊 Matched ${matchedJobs.length} jobs`);
console.log('Role breakdown:', summary.byScore);

// Test LLM enhancement if API key is available
async function testLLM() {
  const llmMatcher = new LLMJobMatcher(process.env.OPENROUTER_API_KEY);
  
  if (!llmMatcher.enabled) {
    console.log('⚠ OPENROUTER_API_KEY not set - skipping LLM enhancement');
    return matchedJobs;
  }
  
  console.log('🤖 Enhancing jobs with LLM...');
  try {
    matchedJobs = await llmMatcher.batchAnalyze(matchedJobs, profile, (current, total) => {
      process.stdout.write(`  Progress: ${current}/${total}\r`);
    });
    console.log('\n✅ LLM enhancement complete');
  } catch (error) {
    console.error('❌ LLM enhancement failed:', error.message);
  }
  
  return matchedJobs;
}

// Test Telegram notification
async function testNotification(matchedJobs) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  
  if (!chatId) {
    console.log('❌ TELEGRAM_CHAT_ID not set in .env');
    return;
  }
  
  console.log('✓ TELEGRAM_CHAT_ID found:', chatId);
  
  const notifier = new Notifier(chatId);
  
  try {
    console.log('📤 Sending notification...');
    await notifier.sendNotification(matchedJobs, summary);
    console.log('✅ Notification sent successfully!');
  } catch (error) {
    console.error('❌ Notification failed:', error.message);
  }
}

// Run tests
async function main() {
  console.log('\n================================');
  console.log('LLM & Notification Connectivity Test');
  console.log('================================\n');
  
  // Test LLM
  const enhancedJobs = await testLLM();
  
  // Test notification
  await testNotification(enhancedJobs);
  
  console.log('\n================================');
  console.log('Test Complete');
  console.log('================================\n');
}

main();
