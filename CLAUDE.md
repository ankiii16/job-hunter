# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Job Hunter** is an automated job scraping and matching tool that searches LinkedIn and Seek (Australian job board) for positions matching your profile. It uses keyword-based matching with optional LLM enhancement and can send results via Telegram.

## Architecture

The application follows a pipeline architecture with these main components:

### Core Components (src/)

1. **JobHunter** (`index.js`) - Main orchestrator
   - Loads configuration from `.env` and `config/profile.json`
   - Coordinates scraping from multiple sources
   - Orchestrates matching and notification
   - Saves results to `data/results/`

2. **LinkedInScraper** (`linkedin-scraper.js`)
   - Requires LinkedIn credentials (email/password)
   - Searches LinkedIn jobs with location and remote filters
   - Fetches job descriptions for top matches
   - Handles authentication and captcha challenges

3. **SeekScraper** (`seek-scraper.js`)
   - Australian job board (no authentication required)
   - Searches regional Victoria locations + remote work
   - Supports concurrent page fetching
   - Extracts jobs via DOM selectors or Next.js payload

4. **JobMatcher** (`matcher.js`)
   - Keyword-based scoring system (1-3 points per skill match)
   - Role categorization (AI Engineer, Backend, Frontend, Fullstack, Mobile)
   - Location prioritization (Regional VIC > Regional AUS > Remote > Other)
   - Filters by minimum match score

5. **LLMJobMatcher** (`llm-matcher.js`) - Optional enhancement
   - Uses OpenRouter API (free tier available)
   - Llama 3.1 8B model for job analysis
   - Adds AI-powered score and role classification
   - Rate limited (500ms delay between requests)

6. **Notifier** (`notifier.js`)
   - Telegram notifications (if configured)
   - Fallback to console output
   - Sends top 10 matches + summary statistics

## Development Commands

```bash
# Run the job hunter
npm start

# Alternative entry point
node src/test.cjs
```

## Configuration

### Environment Variables (.env)
- `LINKEDIN_EMAIL` - LinkedIn account email
- `LINKEDIN_PASSWORD` - LinkedIn account password
- `TELEGRAM_BOT_TOKEN` - Telegram bot token (optional)
- `TELEGRAM_CHAT_ID` - Telegram chat ID (optional)
- `OPENROUTER_API_KEY` - OpenRouter API key for LLM enhancement (optional)

### Profile Configuration (config/profile.json)
- `skills` - Array of skills to match against (React, AI, Backend, etc.)
- `locations.include` - Preferred locations (Remote, Regional VIC/NSW/etc.)
- `locations.exclude` - Excluded metro cities (Sydney, Melbourne, etc.)
- `maxResults` - Maximum number of results (default: 100)
- `minMatchScore` - Minimum score threshold (default: 1)

## Data Storage

- **Results**: `data/results/history.json` - Complete run history (last 100 runs)
- **Snapshots**: `data/results/jobs-{timestamp}.json` - Timestamped job collections
- **Debug**: `src/seek-page.debug.html` - Saved page HTML for debugging

## Key Implementation Details

### LinkedIn Scraping
- Uses Puppeteer in headless mode
- Searches with query like "React OR React Native OR AI Engineering"
- Location: Australia with remote work filter (f_WT=2)
- Fetches descriptions for top 15 jobs to limit runtime
- May encounter captchas or 2FA - falls back gracefully

### Seek Scraping
- Targets Regional Victoria locations: Ballarat, Geelong (postcodes included)
- Also searches general remote positions
- Uses data-automation attributes for job cards
- Falls back to `__NEXT_DATA__` extraction if DOM empty
- Concurrency limit: 4 pages at a time

### Matching Algorithm
- **Skill scoring**: 3pts (title match), 2pts (title+desc match), 1pt (description only)
- **Location scoring**: +100 (Regional VIC), +80 (Regional AUS), +60 (Remote)
- **Role categorization**: Based on job title, matched skills, and keyword density
- **Final sort**: Location priority > Role priority > Match score

### LLM Enhancement (Optional)
- Adds 0-10 additional points based on AI analysis
- Categorizes role with higher accuracy
- Provides reasoning for matches
- Processes sequentially with 500ms delay (respects free API limits)

## Common Workflow

1. Update `config/profile.json` with your skills and preferences
2. Set credentials in `.env`
3. Run `npm start`
4. Check results in `data/results/` or Telegram

## Troubleshooting

### LinkedIn Issues
- Login failures → Check credentials, may need 2FA bypass
- No jobs found → LinkedIn might be blocking headless browser
- Captcha required → Manual login may be needed

### Seek Issues
- Empty results → DOM structure changed, check `seek-page.debug.html`
- No job cards → SEEK may be blocking automation
- Check `__NEXT_DATA__` extraction as fallback

### LLM Issues
- API errors → Check OpenRouter key, may be rate limited
- JSON parsing errors → LLM response format changed
- Disabled if no API key or placeholder value detected

## Dependencies

- **puppeteer** - Browser automation for scraping
- **axios** - HTTP client for API calls and Telegram
- **cheerio** - HTML parsing (not actively used)
- **dotenv** - Environment variable loading