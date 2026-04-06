const axios = require('axios');

class Notifier {
  constructor(telegramChatId) {
    this.telegramChatId = telegramChatId;
    this.telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    this.telegramApi = this.telegramToken && this.telegramChatId
      ? `https://api.telegram.org/bot${this.telegramToken}/sendMessage`
      : null;
  }

  async sendNotification(matchedJobs, summary) {
    const message = this.formatMessage(matchedJobs, summary);

    // Try Telegram first if configured
    if (this.telegramApi) {
      try {
        const result = await this.sendTelegram(message);
        console.log('Telegram notification sent successfully');
        return result;
      } catch (error) {
        console.error('Failed to send Telegram notification:', error.message);
        // Fall back to console output
      }
    }

    // Always log to console as backup
    console.log('\n==== JOB HUNTER RESULTS ====');
    console.log(message);
    console.log('============================\n');

    return { method: 'console', message };
  }

  formatMessage(matchedJobs, summary) {
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

  async sendTelegram(message) {
    if (!this.telegramApi) {
      throw new Error('Telegram not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
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