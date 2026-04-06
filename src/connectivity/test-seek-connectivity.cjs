// Test Seek scraper connectivity
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const SeekScraper = require('../seek-scraper');

async function testSeek() {
  console.log('\n================================');
  console.log('Seek Scraper Connectivity Test');
  console.log('================================\n');

  const seek = new SeekScraper();
  
  try {
    console.log('Initializing Seek scraper...');
    await seek.init();
    console.log('✓ Seek scraper initialized');
    
    console.log('\nSearching for jobs (Regional VIC + Remote)...');
    // Use a broader query so regional areas return results more often.
    const jobs = await seek.searchJobsRegionalVictoriaAndRemote('software developer');
    
    console.log(`\n✓ Found ${jobs.length} jobs from Seek`);
    
    if (jobs.length > 0) {
      console.log('\nSample job:');
      console.log(`  Title: ${jobs[0].title}`);
      console.log(`  Company: ${jobs[0].company}`);
      console.log(`  Location: ${jobs[0].location}`);
      console.log(`  Link: ${jobs[0].link}`);
      
      // Test fetching description for first job
      if (jobs[0].link) {
        console.log('\nFetching job description...');
        const jobWithDesc = await seek.fetchJobDescription(jobs[0]);
        if (jobWithDesc.description) {
          console.log(`✓ Description fetched (${jobWithDesc.description.length} chars)`);
          console.log(`  Preview: ${jobWithDesc.description.substring(0, 200)}...`);
        } else {
          console.log('⚠ No description found');
        }
      }
    }
    
    await seek.close();
    console.log('\n✓ Seek scraper closed');
    
  } catch (error) {
    console.error('\n✗ Seek test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
  
  console.log('\n================================');
  console.log('Seek Test Complete');
  console.log('================================\n');
}

testSeek();
