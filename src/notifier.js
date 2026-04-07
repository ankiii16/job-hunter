const axios = require('axios');
const { Resend } = require('resend');

class Notifier {
  constructor(config = {}) {
    this.mode = config.mode || 'telegram';

    this.telegramToken = config.telegram?.botToken;
    this.telegramChatId = config.telegram?.chatId;
    this.telegramApi = this.telegramToken && this.telegramChatId
      ? `https://api.telegram.org/bot${this.telegramToken}/sendMessage`
      : null;

    this.email = {
      from: config.email?.from,
      to: config.email?.to,
      subjectPrefix: config.email?.subjectPrefix || 'Job Hunter'
    };

    this.resendApiKey = config.email?.resendApiKey || process.env.RESEND_API_KEY;
    this.resend = this.canSendEmail() ? new Resend(this.resendApiKey) : null;
  }

  canSendEmail() {
    return Boolean(
      this.email.from &&
      this.email.to &&
      this.resendApiKey
    );
  }

  getChannels() {
    const mode = String(this.mode || 'telegram').toLowerCase();
    if (mode === 'email') return ['email'];
    if (mode === 'both') return ['telegram', 'email'];
    return ['telegram'];
  }

  async sendNotification(matchedJobs, summary) {
    const telegramMessage = this.formatTelegramMessage(matchedJobs, summary);
    const emailMessage = this.formatEmailMessage(matchedJobs, summary);
    const textMessage = this.formatTextMessage(matchedJobs, summary);
    const channels = this.getChannels();

    for (const channel of channels) {
      try {
        if (channel === 'telegram') {
          const result = await this.sendTelegram(telegramMessage);
          console.log('Telegram notification sent successfully');
          if (this.mode !== 'both') return result;
        } else if (channel === 'email') {
          const result = await this.sendEmail(emailMessage, textMessage);
          console.log('Email notification sent successfully');
          if (this.mode !== 'both') return result;
        }
      } catch (error) {
        console.error(`Failed to send ${channel} notification:`, error.message);
      }
    }

    // Always log to console as backup
    console.log('\n==== JOB HUNTER RESULTS ====');
    console.log(textMessage);
    console.log('============================\n');

    return { method: 'console', message: textMessage };
  }

  formatTelegramMessage(matchedJobs, summary) {
    const date = new Date().toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    let message = `🔍 *Job Hunter Report - ${date}*\n\n`;
    message += `📊 *Summary*: ${summary.total} jobs found\n`;
    message += `  • LinkedIn: ${summary.bySource['LinkedIn'] || 0}\n`;
    message += `  • Seek: ${summary.bySource['Seek'] || 0}\n\n`;

    message += `🏆 <b>Top 10 Matches</b>:\n\n`;

    matchedJobs.slice(0, 10).forEach((job, index) => {
      const score = job.matchScore || 0;
      const title = job.title || 'Unknown Title';
      const company = job.company || 'Unknown Company';
      const location = job.location || 'Unknown Location';
      const role = job.roleCategory || 'General';
      
      message += `${index + 1}. <b>${title}</b> (Score: ${score})\n`;
      message += `   Role: ${role}\n`;
      message += `   Company: ${company}\n`;
      message += `   Location: ${location}\n`;
      message += `   <a href="${job.link}">View Job</a>\n\n`;
    });

    // Add role breakdown
    const roleCounts = {};
    matchedJobs.forEach(job => {
      const role = job.roleCategory || 'General';
      roleCounts[role] = (roleCounts[role] || 0) + 1;
    });
    
    message += `📋 <b>Role Breakdown</b>:\n`;
    for (const [role, count] of Object.entries(roleCounts)) {
      message += `  • ${role}: ${count}\n`;
    }
    message += `\n`;

    // Add location breakdown from summary
    if (summary.locationBreakdown) {
      message += `📍 <b>Location Breakdown</b>:\n`;
      for (const [loc, count] of Object.entries(summary.locationBreakdown)) {
        if (count > 0) {
          message += `  • ${loc}: ${count}\n`;
        }
      }
      message += `\n`;
    }

    if (matchedJobs.length > 10) {
      message += `...and ${matchedJobs.length - 10} more. See history file for full list.\n`;
    }

    return message;
  }

  formatEmailMessage(matchedJobs, summary) {
    const date = new Date().toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Generate HTML email
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Job Hunter Report</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      font-size: 28px;
      margin-bottom: 10px;
    }
    .header p {
      opacity: 0.9;
      font-size: 16px;
    }
    .content {
      padding: 30px;
    }
    .summary {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 30px;
    }
    .summary h2 {
      font-size: 18px;
      margin-bottom: 15px;
      color: #667eea;
    }
    .summary-stats {
      display: flex;
      gap: 30px;
      flex-wrap: wrap;
    }
    .stat {
      flex: 1;
      min-width: 150px;
    }
    .stat-value {
      font-size: 32px;
      font-weight: bold;
      color: #667eea;
    }
    .stat-label {
      font-size: 14px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .section {
      margin-bottom: 30px;
    }
    .section h2 {
      font-size: 20px;
      margin-bottom: 15px;
      color: #333;
      border-bottom: 2px solid #667eea;
      padding-bottom: 8px;
    }
    .job-card {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 15px;
      border-left: 4px solid #667eea;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .job-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .job-title {
      font-size: 18px;
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
    }
    .job-company {
      color: #666;
      font-size: 16px;
      margin-bottom: 4px;
    }
    .job-location {
      color: #888;
      font-size: 14px;
      margin-bottom: 12px;
    }
    .job-meta {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-score {
      background: #667eea;
      color: white;
    }
    .badge-role {
      background: #764ba2;
      color: white;
    }
    .job-link {
      display: inline-block;
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
      margin-top: 8px;
    }
    .job-link:hover {
      text-decoration: underline;
    }
    .breakdown-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .breakdown-item {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .breakdown-value {
      font-size: 24px;
      font-weight: bold;
      color: #667eea;
    }
    .breakdown-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      margin-top: 5px;
    }
    .footer {
      background: #f8f9fa;
      padding: 20px;
      text-align: center;
      color: #666;
      font-size: 14px;
      border-top: 1px solid #e0e0e0;
    }
    @media (max-width: 600px) {
      body {
        padding: 10px;
      }
      .header {
        padding: 20px;
      }
      .content {
        padding: 20px;
      }
      .summary-stats {
        flex-direction: column;
        gap: 15px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔍 Job Hunter Report</h1>
      <p>${date}</p>
    </div>
    
    <div class="content">
      <div class="summary">
        <h2>📊 Summary</h2>
        <div class="summary-stats">
          <div class="stat">
            <div class="stat-value">${summary.total}</div>
            <div class="stat-label">Total Jobs</div>
          </div>
          <div class="stat">
            <div class="stat-value">${summary.bySource['LinkedIn'] || 0}</div>
            <div class="stat-label">LinkedIn</div>
          </div>
          <div class="stat">
            <div class="stat-value">${summary.bySource['Seek'] || 0}</div>
            <div class="stat-label">Seek</div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>🏆 Top Matches</h2>
        ${matchedJobs.map((job, index) => {
          const score = job.matchScore || 0;
          const title = job.title || 'Unknown Title';
          const company = job.company || 'Unknown Company';
          const location = job.location || 'Unknown Location';
          const role = job.roleCategory || 'General';
          
          return `
          <div class="job-card">
            <div class="job-title">${index + 1}. ${this.escapeHtml(title)}</div>
            <div class="job-company">${this.escapeHtml(company)}</div>
            <div class="job-location">📍 ${this.escapeHtml(location)}</div>
            <div class="job-meta">
              <span class="badge badge-score">Score: ${score}</span>
              <span class="badge badge-role">${this.escapeHtml(role)}</span>
            </div>
            <span class="job-link" style="color: #667eea; text-decoration: underline; cursor: pointer;">${this.escapeHtml(job.link)}</span>
          </div>`;
        }).join('')}

      </div>

      <div class="section">
        <h2>📋 Role Breakdown</h2>
        <div class="breakdown-grid">
          ${Object.entries(matchedJobs.reduce((acc, job) => {
            const role = job.roleCategory || 'General';
            acc[role] = (acc[role] || 0) + 1;
            return acc;
          }, {})).map(([role, count]) => `
            <div class="breakdown-item">
              <div class="breakdown-value">${count}</div>
              <div class="breakdown-label">${this.escapeHtml(role)}</div>
            </div>
          `).join('')}
        </div>
      </div>

      ${summary.locationBreakdown && Object.values(summary.locationBreakdown).some(v => v > 0) ? `
      <div class="section">
        <h2>📍 Location Breakdown</h2>
        <div class="breakdown-grid">
          ${Object.entries(summary.locationBreakdown).filter(([_, count]) => count > 0).map(([loc, count]) => `
            <div class="breakdown-item">
              <div class="breakdown-value">${count}</div>
              <div class="breakdown-label">${this.escapeHtml(loc)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}
    </div>

    <div class="footer">
      <p>Generated by Job Hunter • ${new Date().toLocaleDateString('en-AU')}</p>
    </div>
  </div>
</body>
</html>`;

    // Also generate plain text version for fallback
    let text = `Job Hunter Report - ${date}\n\n`;
    text += `Summary: ${summary.total} jobs found\n`;
    text += `  LinkedIn: ${summary.bySource['LinkedIn'] || 0}\n`;
    text += `  Seek: ${summary.bySource['Seek'] || 0}\n\n`;
    text += `Top Matches:\n\n`;
    
    matchedJobs.slice(0, 10).forEach((job, index) => {
      text += `${index + 1}. ${job.title} (Score: ${job.matchScore || 0})\n`;
      text += `   Role: ${job.roleCategory || 'General'}\n`;
      text += `   Company: ${job.company || 'Unknown Company'}\n`;
      text += `   Location: ${job.location || 'Unknown Location'}\n`;
      text += `   Link: ${job.link}\n\n`;
    });

    return { html, text };
  }

  formatTextMessage(matchedJobs, summary) {
    const date = new Date().toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    let message = `Job Hunter Report - ${date}\n\n`;
    message += `Summary: ${summary.total} jobs found\n`;
    message += `  - LinkedIn: ${summary.bySource['LinkedIn'] || 0}\n`;
    message += `  - Seek: ${summary.bySource['Seek'] || 0}\n\n`;
    message += `All Matches (sorted by score):\n\n`;

    matchedJobs.forEach((job, index) => {
      message += `${index + 1}. ${job.title} (Score: ${job.matchScore || 0})\n`;
      message += `   Role: ${job.roleCategory || 'General'}\n`;
      message += `   Company: ${job.company || 'Unknown Company'}\n`;
      message += `   Location: ${job.location || 'Unknown Location'}\n`;
      message += `   Link: ${job.link}\n\n`;
    });

    return message;
  }

  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  async sendTelegram(message) {
    if (!this.telegramApi) {
      throw new Error('Telegram not configured (missing bot token or chat ID)');
    }

    // Telegram has a 4096 character limit
    const maxLength = 4000;
    const messages = [];

    if (message.length <= maxLength) {
      messages.push(message);
    } else {
      // Split message into chunks
      const lines = message.split('\n');
      let currentChunk = '';

      for (const line of lines) {
        if ((currentChunk + line + '\n').length > maxLength) {
          if (currentChunk) messages.push(currentChunk);
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }
      if (currentChunk) messages.push(currentChunk);
    }

    const results = [];
    for (const chunk of messages) {
      const response = await axios.post(this.telegramApi, {
        chat_id: this.telegramChatId,
        text: chunk,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      }, {
        timeout: 10000
      });
      results.push(response.data);
    }

    return { success: true, messages: results.length };
  }

  async sendEmail(emailMessage, textMessage) {
    if (!this.resend || !this.canSendEmail()) {
      throw new Error('Email not configured (missing Resend API key or sender/receiver details)');
    }

    const subject = `${this.email.subjectPrefix} - Job Report`;
    
    // emailMessage can be either a string (HTML) or an object {html, text}
    const html = typeof emailMessage === 'string' ? emailMessage : emailMessage.html;
    const text = typeof emailMessage === 'string' ? textMessage : (emailMessage.text || textMessage);

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.email.from,
        to: this.email.to,
        subject,
        html: html,
        text: text,
        track_links: false,
        trackLins: false,
        track_opens: false,
        trackOpens : false
      });

      if (error) {
       console.error({ error });
      }

      return { success: true, method: 'email', messageId: data?.id || 'sent' };
    } catch (error) {
      console.error('Resend error:', error.response?.data || error.message);
      throw error;
    }
  }

  formatConsole(matchedJobs, summary) {
    console.log('\n========================================');
    console.log('JOB HUNTER RESULTS');
    console.log('========================================\n');

    console.log(`Summary: ${summary.total} jobs found`);
    console.log(`  LinkedIn: ${summary.bySource['LinkedIn'] || 0}`);
    console.log(`  Seek: ${summary.bySource['Seek'] || 0}\n`);

    console.log('Top Matches:\n');
    matchedJobs.slice(0, 10).forEach((job, index) => {
      console.log(`${index + 1}. ${job.title} (Score: ${job.matchScore})`);
      console.log(`   Company: ${job.company}`);
      console.log(`   Location: ${job.location}`);
      console.log(`   Source: ${job.source}`);
      console.log(`   Link: ${job.link}\n`);
    });

    if (matchedJobs.length > 10) {
      console.log(`...${matchedJobs.length - 10} additional matches in history file.\n`);
    }

    console.log('========================================\n');
  }
}

module.exports = Notifier;