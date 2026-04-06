const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const LinkedInScraper = require('./linkedin-scraper');
const SeekScraper = require('./seek-scraper');
const JobMatcher = require('./matcher');
const Notifier = require('./notifier');
const LLMJobMatcher = require('./llm-matcher');

class JobHunter {
  constructor() {
    this.configDir = path.join(__dirname, '..', 'config');
    this.dataDir = path.join(__dirname, '..', 'data');
    this.profile = null;
    this.creds = null;
    this.notifier = null;
    this.llmMatcher = null;
    this.resultsDir = path.join(this.dataDir, 'results');
    this.historyFile = path.join(this.resultsDir, 'history.json');

    this.ensureDirectories();
  }

  ensureDirectories() {
    [this.dataDir, this.resultsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  loadConfig() {
    try {
      // Load profile
      const profilePath = path.join(this.configDir, 'profile.json');
      this.profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      console.log('✓ Profile loaded');

      // Load credentials (from env or config file as fallback)
      this.creds = {
        linkedin: {
          email: process.env.LINKEDIN_EMAIL,
          password: process.env.LINKEDIN_PASSWORD
        },
        telegram: {
          chatId: process.env.TELEGRAM_CHAT_ID
        }
      };

      // Validate critical env vars
      if (!this.creds.linkedin.email || !this.creds.linkedin.password) {
        console.warn('⚠ LinkedIn credentials not set in environment variables');
        console.warn('  Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD');
      }

      if (!this.creds.telegram.chatId) {
        console.warn('⚠ Telegram chat ID not set in environment variables');
        console.warn('  Set TELEGRAM_CHAT_ID');
      }

      this.notifier = new Notifier(this.creds.telegram.chatId);
      
      // Initialize LLM matcher if OpenRouter key is available
      this.llmMatcher = new LLMJobMatcher(process.env.OPENROUTER_API_KEY);

      return true;
    } catch (error) {
      console.error('✗ Failed to load configuration:', error.message);
      return false;
    }
  }

  async run() {
    console.log('\n================================');
    console.log('OpenClaw Job Hunter Starting');
    console.log('================================\n');

    if (!this.loadConfig()) {
      throw new Error('Failed to load configuration');
    }

    const allJobs = [];
    const errors = [];

    // LinkedIn scraping
    if (this.creds.linkedin.email && this.creds.linkedin.password) {
      try {
        const linkedin = new LinkedInScraper(
          this.creds.linkedin.email,
          this.creds.linkedin.password
        );
        await linkedin.init();
        await linkedin.login();

        const linkedinJobs = await linkedin.searchJobs(
          this.getSearchQuery(),
          this.getSearchLocation(),
          true // remote
        );

        console.log(`Found ${linkedinJobs.length} LinkedIn jobs before fetching descriptions`);

        // Fetch descriptions for top LinkedIn jobs (to limit runtime)
        const topLinkedinJobs = linkedinJobs.slice(0, 15);
        for (const job of topLinkedinJobs) {
          try {
            await linkedin.fetchJobDescription(job);
          } catch (error) {
            console.error(`Failed to fetch LinkedIn job description: ${job.title}`);
          }
        }

        allJobs.push(...linkedinJobs);
        await linkedin.close();

        console.log(`✓ LinkedIn: ${linkedinJobs.length} jobs collected`);
      } catch (error) {
        console.error('✗ LinkedIn scraping failed:', error.message);
        errors.push({ source: 'LinkedIn', error: error.message });
      }
    } else {
      console.log('⊘ Skipping LinkedIn (credentials not set)');
    }

    // Seek scraping (no auth required)
    try {
      const seek = new SeekScraper();
      await seek.init();
      const seekQueries = this.getSeekQueries();
      const seekJobs = [];
      const seenSeekLinks = new Set();

      for (const query of seekQueries) {
        console.log(`\nSEEK query: "${query}"`);
        const jobsForQuery = await seek.searchJobsInLocations(
          query,
          seek.regionalVictoriaSeekLocationSlugs,
          { includeRemote: true, maxPagesPerLocation: 1, concurrency: 4 }
        );

        for (const job of jobsForQuery) {
          const key = job.link || `${job.source}:${job.id}`;
          if (seenSeekLinks.has(key)) continue;
          seenSeekLinks.add(key);
          seekJobs.push(job);
        }
      }

      console.log(`Found ${seekJobs.length} Seek jobs before fetching descriptions`);

      // Fetch descriptions for top Seek jobs
      const topSeekJobs = seekJobs.slice(0, 15);
      for (const job of topSeekJobs) {
        try {
          await seek.fetchJobDescription(job);
        } catch (error) {
          console.error(`Failed to fetch Seek job description: ${job.title}`);
        }
      }

      allJobs.push(...seekJobs);
      console.log(`✓ Seek: ${seekJobs.length} jobs collected`);
      await seek.close();
    } catch (error) {
      console.error('✗ Seek scraping failed:', error.message);
      errors.push({ source: 'Seek', error: error.message });
    }

    if (allJobs.length === 0) {
      console.log('\n⚠ No jobs found from any source');
      this.saveResults([], errors);
      return;
    }

    // Match jobs
    console.log(`\nMatching ${allJobs.length} jobs...`);
    const matcher = new JobMatcher(this.profile);
    let matchedJobs = matcher.matchJobs(allJobs);
    
    // Enhance with LLM if available
    if (this.llmMatcher && this.llmMatcher.enabled) {
      console.log('Enhancing matches with LLM...');
      matchedJobs = await this.llmMatcher.batchAnalyze(matchedJobs, this.profile, (current, total) => {
        console.log(`  LLM progress: ${current}/${total}`);
      });
    }
    
    const summary = matcher.generateSummary(matchedJobs);

    // Save results
    this.saveResults(matchedJobs, errors, summary);

    // Send notification
    await this.notifier.sendNotification(matchedJobs, summary);

    console.log('\n================================');
    console.log('Job Hunter Run Complete');
    console.log('================================\n');
  }

  getSearchQuery() {
    // Build a search query from skills
    const primarySkills = ['React', 'React Native', 'AI Engineering', 'Backend', 'Frontend', 'Spring Boot', 'AWS'];
    return primarySkills.slice(0, 3).join(' OR ');
  }

  getSearchLocation() {
    return 'Australia';
  }

  getSeekQueries() {
    // // SEEK works better with focused keyword queries than one large OR clause.
    // const profileSkills = Array.isArray(this.profile?.skills) ? this.profile.skills : [];
    // const primary = profileSkills.slice(0, 8).map(s => String(s || '').trim()).filter(Boolean);
    // return ['AI Engineer', 'Backend Developer', 'Frontend Developer'];
    return ["Full Stack Developer"];
  }

  saveResults(matchedJobs, errors, summary) {
    try {
      const result = {
        runId: `run-${Date.now()}`,
        timestamp: new Date().toISOString(),
        summary,
        matchedJobs: matchedJobs,
        errors,
        configSnapshot: {
          skills: this.profile.skills,
          locations: this.profile.locations
        }
      };

      // Save current run
      const history = this.loadHistory();
      history.unshift(result);

      // Limit history to last 100 runs
      if (history.length > 100) {
        history.splice(100);
      }

      fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2), 'utf8');
      console.log(`✓ Results saved to: ${this.historyFile}`);

      // Also save timestamped snapshot of this run's jobs
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const snapshotFile = path.join(this.resultsDir, `jobs-${timestamp}.json`);
      fs.writeFileSync(snapshotFile, JSON.stringify(matchedJobs, null, 2), 'utf8');
      console.log(`✓ Job snapshot saved to: ${snapshotFile}`);

    } catch (error) {
      console.error('✗ Failed to save results:', error.message);
    }
  }

  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading history file:', error.message);
    }
    return [];
  }
}

module.exports = JobHunter;

