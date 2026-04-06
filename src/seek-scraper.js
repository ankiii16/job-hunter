const puppeteer = require('puppeteer');

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function* walkJson(value) {
  // Iterative DFS to avoid call stack blowups on huge JSON.
  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || (typeof cur !== 'object' && !Array.isArray(cur))) continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    yield cur;
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
    } else {
      for (const k of Object.keys(cur)) stack.push(cur[k]);
    }
  }
}

function normalizeSeekJob(item) {
  if (!item || typeof item !== 'object') return null;

  const id =
    item.id ||
    item.jobId ||
    item.listingId ||
    item.jobListingId ||
    item.jobID ||
    item?.job?.id;

  const title =
    item.title ||
    item.jobTitle ||
    item?.job?.title ||
    item?.listingTitle ||
    item?.name;

  const company =
    item.company ||
    item.companyName ||
    item.advertiserName ||
    item?.advertiser?.name ||
    item?.advertiser?.description ||
    item?.hirer?.name;

  const location =
    item.location ||
    item.locationName ||
    item.area ||
    item?.location?.label ||
    item?.location?.name ||
    item?.jobLocation;

  const url =
    item.url ||
    item.jobUrl ||
    item.seoUrl ||
    item?.job?.url ||
    item?.job?.seoUrl ||
    item?.links?.self;

  const link =
    (typeof url === 'string' && url.startsWith('http') && url) ||
    (typeof url === 'string' && url.startsWith('/') && `https://www.seek.com.au${url}`) ||
    (id ? `https://www.seek.com.au/job/${id}` : '');

  if (!title || !link) return null;

  return {
    id: id ? String(id) : `seek-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source: 'Seek',
    title: String(title).trim(),
    company: company ? String(company).trim() : 'Unknown Company',
    location: location ? String(location).trim() : 'Unknown Location',
    link,
    description: '',
    postedDate: new Date().toISOString()
  };
}

class SeekScraper {
  constructor() {
    this.browser = null;
    // Regional Victoria location slugs for SEEK /in-... URLs.
    // Include postcodes because SEEK often resolves these pages more reliably.
    this.regionalVictoriaSeekLocationSlugs = [
      'Ballarat-VIC-3350',
      // 'Bendigo-VIC-3550',
      'Geelong-VIC-3220',
      // 'Shepparton-VIC-3630',
      // 'Warrnambool-VIC-3280',
      // 'Wangaratta-VIC-3677',
      // 'Mildura-VIC-3500',
      // 'Traralgon-VIC-3844',
      // 'Bairnsdale-VIC-3875',
      // 'Horsham-VIC-3400',
      // 'Sale-VIC-3850',
      // 'Ararat-VIC-3377',
      // 'Maryborough-VIC-3465',
      // 'Hamilton-VIC-3300',
      // 'Portland-VIC-3305',
      // 'Wonthaggi-VIC-3995'
    ];
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  async extractJobsFromNextData(page) {
    try {
      const nextDataText = await page.$eval('#__NEXT_DATA__', el => el.textContent);
      const nextData = safeJsonParse(nextDataText);
      if (!nextData) return [];

      // SEEK’s Next.js payload structure changes; do a generic walk to find arrays
      // of job-ish objects and normalize them.
      const jobs = [];
      const seenLinks = new Set();

      for (const node of walkJson(nextData)) {
        if (!node || typeof node !== 'object') continue;

        // If this node is an array-like container of job objects, try to normalize each.
        const arrays = [];
        if (Array.isArray(node)) arrays.push(node);
        if (!Array.isArray(node)) {
          for (const v of Object.values(node)) if (Array.isArray(v)) arrays.push(v);
        }

        for (const arr of arrays) {
          // Quick heuristics: must contain some objects with title-ish fields.
          let maybeJobs = 0;
          for (let i = 0; i < Math.min(arr.length, 10); i++) {
            const it = arr[i];
            if (it && typeof it === 'object' && (it.title || it.jobTitle || it?.job?.title || it?.advertiser)) {
              maybeJobs++;
            }
          }
          if (maybeJobs === 0) continue;

          for (const it of arr) {
            const job = normalizeSeekJob(it);
            if (!job) continue;
            if (seenLinks.has(job.link)) continue;
            seenLinks.add(job.link);
            jobs.push(job);
          }
        }
      }

      return jobs;
    } catch {
      return [];
    }
  }

  toSeekSlug(str) {
    return String(str || '')
      .trim()
      .replace(/&/g, ' and ')
      .replace(/[()]/g, ' ')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  buildSeekInLocationUrl(query, locationSlug) {
    const locSlug = String(locationSlug || '').replace(/^in-?/i, '');
    return `https://www.seek.com.au/jobs/in-${locSlug}?keywords=${encodeURIComponent(query)}`;
  }

  buildSeekRemoteUrl(query, location = 'Australia') {
    return `https://www.seek.com.au/jobs?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&remoteWork=remote`;
  }

  withPageParam(url, pageNum) {
    if (!pageNum || pageNum <= 1) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}page=${pageNum}`;
  }

  expandLocationSlugs(locationSlugs = []) {
    const expanded = [];
    const seen = new Set();

    for (const loc of locationSlugs) {
      const withPostcode = this.toSeekSlug(loc);
      if (!withPostcode) continue;

      if (!seen.has(withPostcode)) {
        expanded.push(withPostcode);
        seen.add(withPostcode);
      }

      // Try a fallback without postcode as well: in-Ballarat-VIC
      const withoutPostcode = withPostcode.replace(/-\d{4}$/, '');
      if (withoutPostcode && !seen.has(withoutPostcode)) {
        expanded.push(withoutPostcode);
        seen.add(withoutPostcode);
      }
    }

    return expanded;
  }

  async searchJobsByUrl(url) {
    console.log('Seek URL:', url);
    if (!this.browser) {
      throw new Error('SeekScraper not initialized. Call init() before search.');
    }

    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
      console.log('Navigating to Seek...');
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      console.log('Page loaded, waiting for job links...');
      
      // Wait for job cards to appear
      try {
        await page.waitForSelector(
          'a[data-automation="jobTitle"], a[data-automation="job-list-view-job-link"]',
          { timeout: 15000 }
        );
        console.log('Job links found');
      } catch (e) {
        console.log('No job cards found with standard selector, checking page title...');
        const title = await page.title();
        console.log('Page title:', title);
      }
      
      await new Promise(r => setTimeout(r, 3000));

      // Scroll to load more jobs
      console.log('Scrolling to load jobs...');
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await new Promise(r => setTimeout(r, 1500));
        console.log(`  Scroll ${i+1}/3 complete`);
      }

      console.log('Extracting job cards...');
      
      // Debug: dump some HTML to see structure
      const pageHtml = await page.content();
      console.log('Page HTML length:', pageHtml.length);
      if (pageHtml.includes('jobCard') || pageHtml.includes('job-card')) {
        console.log('Found jobCard in HTML');
      } else {
        console.log('No jobCard found in HTML - may be blocked or different structure');
        // Save to file for debugging (in workspace so it’s readable in Cursor)
        const fs = require('fs');
        const path = require('path');
        const outPath = path.join(process.cwd(), 'seek-page.debug.html');
        fs.writeFileSync(outPath, pageHtml);
        console.log(`Saved page HTML to ${outPath}`);
      }

      // Extract jobs (SEEK frequently uses job-list-* data-automation attributes)
      let jobs = await page.evaluate(() => {
        const results = [];
        const seen = new Set();

        const titleLinks = Array.from(
          document.querySelectorAll('a[data-automation="jobTitle"]')
        );

        for (const titleEl of titleLinks) {
          try {
            const title = titleEl.textContent?.trim() || '';
            const link = titleEl.href || '';
            if (!title || !link) continue;
            if (seen.has(link)) continue;
            seen.add(link);

            // Find the containing card-ish element and pull nearby fields.
            const root =
              titleEl.closest('article') ||
              titleEl.closest('[data-testid*="job"]') ||
              titleEl.closest('li') ||
              titleEl.closest('div');

            const companyEl =
              root?.querySelector('[data-automation="advertiser-name"]') ||
              root?.querySelector('[data-automation="jobCompany"]') ||
              root?.querySelector('[data-testid="company-name"]');

            const locationEl =
              root?.querySelector('[data-automation="jobLocation"]') ||
              root?.querySelector('[data-automation="location"]') ||
              root?.querySelector('[data-testid="job-location"]');

            const company = companyEl?.textContent?.trim() || 'Unknown Company';
            const location = locationEl?.textContent?.trim() || 'Unknown Location';
            const jobId = link.split('/job/')[1]?.split('/')[0]?.split('?')[0];

            results.push({
              id: jobId || `seek-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              source: 'Seek',
              title,
              company,
              location,
              link,
              description: '',
              postedDate: new Date().toISOString()
            });
          } catch {
            // Skip invalid cards
          }
        }

        return results;
      });

      // Fallback: SEEK often renders jobs from Next.js payload; DOM selectors may be empty.
      if (!jobs || jobs.length === 0) {
        console.log('DOM extraction returned 0 jobs, trying __NEXT_DATA__ fallback...');
        const nextJobs = await this.extractJobsFromNextData(page);
        if (nextJobs.length > 0) {
          console.log(`__NEXT_DATA__ fallback found ${nextJobs.length} jobs`);
          jobs = nextJobs;
        } else {
          console.log('__NEXT_DATA__ fallback also returned 0 jobs');
        }
      }

      console.log(`Found ${jobs.length} job cards on Seek`);
      return jobs;
    } catch (error) {
      console.error('Error fetching Seek jobs:', error.message);
      return [];
    } finally {
      await page.close().catch(() => {});
    }
  }

  async mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    });

    await Promise.all(runners);
    return results;
  }

  async searchJobsInLocations(
    query,
    locationSlugs = [],
    { includeRemote = true, maxPagesPerLocation = 2, concurrency = 4 } = {}
  ) {
    const urls = [];
    const expandedSlugs = this.expandLocationSlugs(locationSlugs);

    for (const slug of expandedSlugs) {
      const baseUrl = this.buildSeekInLocationUrl(query, slug);
      for (let pageNum = 1; pageNum <= maxPagesPerLocation; pageNum++) {
        urls.push(this.withPageParam(baseUrl, pageNum));
      }
    }

    if (includeRemote) {
      const remoteBase = this.buildSeekRemoteUrl(query, 'Australia');
      for (let pageNum = 1; pageNum <= maxPagesPerLocation; pageNum++) {
        urls.push(this.withPageParam(remoteBase, pageNum));
      }
    }

    const all = [];
    const seen = new Set();

    const resultsPerUrl = await this.mapWithConcurrency(urls, concurrency, async (url) => {
      return await this.searchJobsByUrl(url);
    });

    for (const jobs of resultsPerUrl) {
      for (const job of jobs) {
        const key = job.link || `${job.source}:${job.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(job);
      }
    }

    return all;
  }

  async searchJobsRegionalVictoriaAndRemote(query = 'software engineer') {
    // Keep this list finite to avoid very long runs in connectivity tests.
    return await this.searchJobsInLocations(query, this.regionalVictoriaSeekLocationSlugs, { includeRemote: true });
  }

  // Backwards-compatible entry point:
  // - If you pass a single location string, it uses the classic query-param search.
  // - If you pass an array, it scrapes each /in-... location URL (plus remote).
  async searchJobs(query = 'software engineer', location = 'Australia', remote = true) {
    if (Array.isArray(location)) {
      console.log(`Searching Seek jobs across ${location.length} locations + remote=${remote}`);
      return await this.searchJobsInLocations(query, location, { includeRemote: remote });
    }

    // Default: query-param search (not remote-only)
    console.log(`Searching Seek jobs: "${query}" in "${location}" (remote=${remote})`);
    const url = `https://www.seek.com.au/jobs?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}`;
    return await this.searchJobsByUrl(url);
  }

  async fetchJobDescription(job) {
    try {
      console.log(`Fetching Seek description for: ${job.title}`);
      const page = await this.browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      
      await page.goto(job.link, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      const description = await page.evaluate(() => {
        const selectors = [
          '[data-automation="jobDescription"]',
          '.job-view-html-content',
          '.templatetext',
          '#jobDescription',
          '.job-details__description',
          'div[data-automation="jobAdDetails"]',
          'section[data-automation="jobAdDetails"]',
          '[data-testid="job-description"]'
        ];
        
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            const text = el.textContent?.trim();
            if (text && text.length > 100) return text;
          }
        }
        return '';
      });
      
      if (description) {
        job.description = description;
      } else {
        console.warn(`Could not extract Seek description for: ${job.title}`);
      }
      
      await page.close();
      return job;
    } catch (error) {
      console.error(`Error fetching Seek description for ${job.title}:`, error.message);
      return job;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = SeekScraper;