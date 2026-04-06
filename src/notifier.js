const axios = require('axios');
const nodemailer = require('nodemailer');

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
      smtpHost: config.email?.smtpHost,
      smtpPort: Number(config.email?.smtpPort || 587),
      smtpSecure: Boolean(config.email?.smtpSecure),
      smtpUser: config.email?.smtpUser,
      smtpPass: config.email?.smtpPass,
      subjectPrefix: config.email?.subjectPrefix || 'Job Hunter'
    };

    this.mailTransporter = this.canSendEmail()
      ? nodemailer.createTransport({
          host: this.email.smtpHost,
          port: this.email.smtpPort,
          secure: this.email.smtpSecure,
          auth: {
            user: this.email.smtpUser,
            pass: this.email.smtpPass
          }
        })
      : null;
  }

  canSendEmail() {
    return Boolean(
      this.email.from &&
      this.email.to &&
      this.email.smtpHost &&
      this.email.smtpUser &&
      this.email.smtpPass
    );
  }

  getChannels() {
    const mode = String(this.mode || 'telegram').toLowerCase();
    if (mode === 'email') return ['email'];
    if (mode === 'both') return ['telegram', 'email'];
    return ['telegram'];
  }

  async sendNotification(matchedJobs, summary) {
    const htmlMessage = this.formatMessage(matchedJobs, summary);
    const textMessage = this.formatTextMessage(matchedJobs, summary);
    const channels = this.getChannels();

    for (const channel of channels) {
      try {
        if (channel === 'telegram') {
          const result = await this.sendTelegram(htmlMessage);
          console.log('Telegram notification sent successfully');
          if (this.mode !== 'both') return result;
        } else if (channel === 'email') {
          const result = await this.sendEmail(htmlMessage, textMessage);
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
    message += `Top 10 Matches:\n\n`;

    matchedJobs.slice(0, 10).forEach((job, index) => {
      message += `${index + 1}. ${job.title} (Score: ${job.matchScore || 0})\n`;
      message += `   Role: ${job.roleCategory || 'General'}\n`;
      message += `   Company: ${job.company || 'Unknown Company'}\n`;
      message += `   Location: ${job.location || 'Unknown Location'}\n`;
      message += `   Link: ${job.link}\n\n`;
    });

    return message;
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

  async sendEmail(htmlMessage, textMessage) {
    if (!this.mailTransporter || !this.canSendEmail()) {
      throw new Error('Email not configured (missing SMTP or sender/receiver details)');
    }

    const subject = `${this.email.subjectPrefix} - Job Report`;
    const info = await this.mailTransporter.sendMail({
      from: this.email.from,
      to: this.email.to,
      subject,
      text: textMessage,
      html: htmlMessage
    });

    return { success: true, method: 'email', messageId: info.messageId };
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