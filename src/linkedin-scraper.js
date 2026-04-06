const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class LinkedInScraper {
  constructor(email, password) {
    this.email = email;
    this.password = password;
    this.browser = null;
    this.page = null;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
    });
    this.page = await this.browser.newPage();
    await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await this.page.setViewport({ width: 1920, height: 1080 });
  }

  async login() {
    console.log('Logging into LinkedIn...');
    await this.page.goto('https://www.linkedin.com/login', { waitUntil: 'load', timeout: 90000 });

    await this.page.type('#username', this.email, { delay: 100 });
    await this.page.type('#password', this.password, { delay: 100 });
    await this.page.click('button[type="submit"]');

    try {
      await this.page.waitForNavigation({ waitUntil: 'load', timeout: 90000 });
      console.log('Login successful');
    } catch (error) {
      console.error('Login failed or took too long:', error.message);
      // Continue anyway - might still work
    }

    // Check if login was successful
    const url = this.page.url();
    if (url.includes('login') || url.includes('challenge')) {
      throw new Error('LinkedIn login failed - possible 2FA or captcha required');
    }
  }

  async searchJobs(query = 'software engineer', location = 'Australia', remote = true) {
    console.log(`Searching LinkedIn jobs: "${query}" in "${location}"`);

    let searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}`;
    if (remote) {
      searchUrl += '&f_WT=2';
    }

    console.log('Search URL:', searchUrl);
    
    try {
      await this.page.goto(searchUrl, { waitUntil: 'load', timeout: 90000 });
    } catch (err) {
      console.log('Navigation error:', err.message);
      // Continue anyway - the page might have partially loaded
    }

    // Wait for any job content to appear
    await new Promise(r => setTimeout(r, 5000));

    // Wait for job list to load - try multiple selectors
    await this.page.waitForFunction(() => {
      return document.querySelector('.jobs-search-results-list') || 
             document.querySelector('.scaffold-finite-scroll') ||
             document.querySelector('[data-test="job-search-results-list"]') ||
             document.querySelector('.jobs-container');
    }, { timeout: 30000 }).catch(() => console.log('Using alternative wait method...'));

    // Give extra time for React to render
    await new Promise(r => setTimeout(r, 3000));

    const jobs = [];

    // Extract job cards - try multiple selectors
    let jobCards = await this.page.$$('.jobs-search-results__list-item');
    if (jobCards.length === 0) {
      jobCards = await this.page.$$('[data-test="job-card-container"]');
    }
    if (jobCards.length === 0) {
      jobCards = await this.page.$$('.job-card-container');
    }
    
    console.log(`Found ${jobCards.length} job cards on LinkedIn`);

    for (const card of jobCards) {
      try {
        const job = await this.extractJobFromCard(card);
        if (job) jobs.push(job);
      } catch (error) {
        // Skip failed extractions
      }
    }

    return jobs;
  }

  async extractJobFromCard(card) {
    try {
      // Get all relevant data from the card using evaluate
      const cardData = await card.evaluate(el => {
        // Get job ID from data attribute
        const jobId = el.getAttribute('data-job-id') || '';
        
        // Find link - the job card link
        const linkEl = el.querySelector('.job-card-container__link');
        const link = linkEl ? 'https://www.linkedin.com' + linkEl.getAttribute('href') : '';
        
        // Get title - from aria-label or the strong tag inside
        let title = '';
        if (linkEl) {
          title = linkEl.getAttribute('aria-label') || '';
        }
        if (!title) {
          const strongEl = el.querySelector('.job-card-container__link strong');
          if (strongEl) title = strongEl.textContent.trim();
        }
        
        // Get company - from the subtitle
        let company = '';
        const companyEl = el.querySelector('.artdeco-entity-lockup__subtitle');
        if (companyEl) {
          company = companyEl.textContent.trim();
        }
        
        // Get location - from the metadata wrapper
        let location = '';
        const locEl = el.querySelector('.job-card-container__metadata-wrapper');
        if (locEl) {
          location = locEl.textContent.trim();
        }
        
        return { jobId, link, title, company, location };
      });

      if (!cardData.link) return null;

      return {
        id: cardData.jobId || `linkedin-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        source: 'LinkedIn',
        title: cardData.title || 'Unknown Title',
        company: cardData.company || 'Unknown Company',
        location: cardData.location || 'Unknown Location',
        link: cardData.link,
        description: '',
        postedDate: new Date().toISOString(),
        rawData: {
          title: cardData.title,
          company: cardData.company,
          location: cardData.location
        }
      };
    } catch (error) {
      console.error('Error extracting job card details:', error.message);
      return null;
    }
  }

  async fetchJobDescription(job) {
    try {
      console.log(`Fetching description for: ${job.title}`);
      const page = await this.browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

      await page.goto(job.link, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Try multiple selectors for job description
      const descriptionSelectors = [
        '.jobs-description__content',
        '.jobs-box__html-content',
        '.description__text',
        '[data-job-description]',
        '.show-more-less-html__markup'
      ];

      let description = '';
      for (const selector of descriptionSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            description = await element.evaluate(el => el.textContent.trim());
            if (description.length > 100) break;
          }
        } catch {
          continue;
        }
      }

      await page.close();

      if (description) {
        job.description = description;
      } else {
        console.warn(`Could not extract description for: ${job.title}`);
      }

      return job;
    } catch (error) {
      console.error(`Error fetching job description for ${job.title}:`, error.message);
      return job;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = LinkedInScraper;