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

  deepMerge(base = {}, override = {}) {
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
        result[key] = this.deepMerge(baseValue, value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  loadJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
      const selectedProfile = process.env.JOB_PROFILE || 'default';
      const commonPath = path.join(this.configDir, 'common.json');
      const namedProfilePath = path.join(this.configDir, 'profiles', `${selectedProfile}.json`);
      const legacyProfilePath = path.join(this.configDir, 'profile.json');

      const commonConfig = this.loadJsonIfExists(commonPath) || {};
      const namedProfileConfig = this.loadJsonIfExists(namedProfilePath);
      const legacyProfileConfig = this.loadJsonIfExists(legacyProfilePath);

      if (namedProfileConfig) {
        this.profile = this.deepMerge(commonConfig, namedProfileConfig);
        console.log(`✓ Profile loaded: ${selectedProfile}`);
      } else if (legacyProfileConfig) {
        this.profile = this.deepMerge(commonConfig, legacyProfileConfig);
        console.log('✓ Profile loaded: default (legacy profile.json)');
      } else {
        throw new Error('No profile configuration found. Add config/profiles/<name>.json or config/profile.json');
      }

      // Load credentials (from env or config file as fallback)
      this.creds = {
        linkedin: {
          email: process.env.LINKEDIN_EMAIL,
          password: process.env.LINKEDIN_PASSWORD
        },
        telegram: {
          botToken: this.profile?.notifications?.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN,
          chatId: this.profile?.notifications?.telegram?.chatId || process.env.TELEGRAM_CHAT_ID
        },
        email: {
          from: this.profile?.notifications?.email?.from || process.env.EMAIL_FROM,
          to: this.profile?.notifications?.email?.to || process.env.EMAIL_TO,
          resendApiKey: this.profile?.notifications?.email?.resendApiKey || process.env.RESEND_API_KEY,
          subjectPrefix: this.profile?.notifications?.email?.subjectPrefix || process.env.EMAIL_SUBJECT_PREFIX || 'Job Hunter'
        }
      };

      // Validate critical env vars
      if (!this.creds.linkedin.email || !this.creds.linkedin.password) {
        console.warn('⚠ LinkedIn credentials not set in environment variables');
        console.warn('  Set LINKEDIN_EMAIL and LINKEDIN_PASSWORD');
      }

      if (!this.creds.telegram.botToken || !this.creds.telegram.chatId) {
        console.warn('⚠ Telegram not fully configured (bot token/chat ID)');
        console.warn('  Set profile.notifications.telegram.{botToken,chatId} or TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID');
      }

      const emailConfigured = Boolean(
        this.creds.email.from &&
        this.creds.email.to &&
        this.creds.email.resendApiKey
      );
      if (!emailConfigured) {
        console.warn('⚠ Email not fully configured');
        console.warn('  Set profile.notifications.email.resendApiKey or RESEND_API_KEY in .env');
      }

      this.notifier = new Notifier({
        mode: this.profile?.notifications?.mode || 'email',
        telegram: this.creds.telegram,
        email: this.creds.email
      });
      
      // Initialize LLM matcher if OpenRouter key is available
      // this.llmMatcher = new LLMJobMatcher(process.env.OPENROUTER_API_KEY);

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

    const linkedinConfig = this.profile?.search?.linkedin || {};
    const linkedinEnabled = linkedinConfig.enabled !== false;
    const linkedinDescriptionLimit = Number(linkedinConfig.maxDescriptions || 15);
    const linkedinQuery = this.getLinkedInSearchQuery();
    const linkedinLocation = this.getLinkedInSearchLocation();
    const linkedinRemoteOnly = linkedinConfig.remoteOnly !== false;

    // LinkedIn scraping
    if (linkedinEnabled && this.creds.linkedin.email && this.creds.linkedin.password) {
      try {
        const linkedin = new LinkedInScraper(
          this.creds.linkedin.email,
          this.creds.linkedin.password
        );
        await linkedin.init();
        await linkedin.login();

        const linkedinJobs = await linkedin.searchJobs(
          linkedinQuery,
          linkedinLocation,
          linkedinRemoteOnly
        );

        console.log(`Found ${linkedinJobs.length} LinkedIn jobs before fetching descriptions`);

        // Fetch descriptions for top LinkedIn jobs (to limit runtime)
        const topLinkedinJobs = linkedinJobs.slice(0, linkedinDescriptionLimit);
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
      const reason = linkedinEnabled ? 'credentials not set' : 'disabled in profile config';
      console.log(`⊘ Skipping LinkedIn (${reason})`);
    }

    // Seek scraping (no auth required)
    const seekConfig = this.profile?.search?.seek || {};
    const seekEnabled = seekConfig.enabled !== false;

    if (seekEnabled) {
      try {
      const seek = new SeekScraper();
      await seek.init();
      const seekQueries = this.getSeekQueries();
      const seekLocationSlugs = this.getSeekLocationSlugs();
      const seekJobs = [];
      const seenSeekLinks = new Set();

      for (const query of seekQueries) {
        console.log(`\nSEEK query: "${query}"`);
        const jobsForQuery = await seek.searchJobsInLocations(
          query,
          seekLocationSlugs,
          {
            includeRemote: seekConfig.includeRemote !== false,
            remoteLocation: seekConfig.remoteLocation || 'Australia',
            maxPagesPerLocation: Number(seekConfig.maxPagesPerLocation || 1),
            concurrency: Number(seekConfig.concurrency || 4)
          }
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
      const topSeekJobs = seekJobs.slice(0, Number(seekConfig.maxDescriptions || 15));
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
    } else {
      console.log('⊘ Skipping Seek (disabled in profile config)');
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
    
    // // Enhance with LLM if available
    // if (this.llmMatcher && this.llmMatcher.enabled) {
    //   console.log('Enhancing matches with LLM...');
    //   matchedJobs = await this.llmMatcher.batchAnalyze(matchedJobs, this.profile, (current, total) => {
    //     console.log(`  LLM progress: ${current}/${total}`);
    //   });
    // }
    
    const summary = matcher.generateSummary(matchedJobs);

    // Save results
    this.saveResults(matchedJobs, errors, summary);

    // Send notification
    await this.notifier.sendNotification(matchedJobs, summary);

    console.log('\n================================');
    console.log('Job Hunter Run Complete');
    console.log('================================\n');
  }

  getLinkedInSearchQuery() {
    const configured = this.profile?.search?.linkedin?.query;
    if (configured && String(configured).trim()) {
      return String(configured).trim();
    }

    const profileSkills = Array.isArray(this.profile?.skills) ? this.profile.skills : [];
    const fallbackSkills = profileSkills
      .map(skill => String(skill || '').trim())
      .filter(Boolean)
      .slice(0, 4);

    if (fallbackSkills.length > 0) {
      return fallbackSkills.join(' OR ');
    }

    return 'Software Engineer';
  }

  getLinkedInSearchLocation() {
    return this.profile?.search?.linkedin?.location || 'Australia';
  }

  getSeekQueries() {
    const configured = this.profile?.search?.seek?.queries;
    if (Array.isArray(configured) && configured.length > 0) {
      return configured.map(q => String(q || '').trim()).filter(Boolean);
    }

    return ['Software Engineer'];
  }

  getSeekLocationSlugs() {
    const configured = this.profile?.search?.seek?.locationSlugs;
    if (Array.isArray(configured) && configured.length > 0) {
      return configured.map(slug => String(slug || '').trim()).filter(Boolean);
    }
    return [];
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

