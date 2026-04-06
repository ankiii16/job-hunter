// Diagnostic script to see what Seek actually returns
const puppeteer = require('puppeteer');

async function diagnose() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const page = await browser.newPage();
  
  // More stealthy settings
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });
  
  // Try to avoid detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  
  const url = 'https://www.seek.com.au/jobs?keywords=React%20Developer&location=Australia&remoteWork=remote';
  console.log('Navigating to:', url);
  
  await page.goto(url, { 
    waitUntil: 'networkidle2', 
    timeout: 60000 
  });
  
  // Wait a bit for any challenges to potentially resolve
  await new Promise(r => setTimeout(r, 5000));
  
  const title = await page.title();
  console.log('Page title:', title);
  
  const html = await page.content();
  console.log('\n=== HTML LENGTH:', html.length, '===\n');
  
  // Check for common elements
  console.log('Contains "Just a moment":', html.includes('Just a moment'));
  console.log('Contains "cf-challenge":', html.includes('cf-challenge') || html.includes('__cf_chl'));
  console.log('Contains "jobCard":', html.includes('jobCard'));
  console.log('Contains "data-automation":', html.includes('data-automation'));
  
  // Look for any job-related content
  if (html.includes('job') || html.includes('Job')) {
    console.log('\n--- Sample HTML snippet ---');
    const snippet = html.substring(0, 2000);
    console.log(snippet);
    console.log('--- End snippet ---\n');
  }
  
  // Try to find job cards with various selectors
  const cardCounts = await page.evaluate(() => {
    const selectors = [
      'article[data-automation="jobCard"]',
      '[data-automation="job-card"]',
      'article[class*="job"]',
      'div[class*="jobCard"]',
      'div[class*="job-card"]',
      'div[data-testid="job-card"]',
      'div[class*="JobCard"]'
    ];
    
    const results = {};
    selectors.forEach(sel => {
      results[sel] = document.querySelectorAll(sel).length;
    });
    return results;
  });
  
  console.log('\nJob card selector counts:');
  for (const [sel, count] of Object.entries(cardCounts)) {
    if (count > 0) {
      console.log(`  ${sel}: ${count}`);
    }
  }
  
  // Save HTML for analysis
  const fs = require('fs');
  fs.writeFileSync('/tmp/seek-diagnostic.html', html);
  console.log('\nSaved full HTML to /tmp/seek-diagnostic.html');
  
  await browser.close();
}

diagnose().catch(console.error);
