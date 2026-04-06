// LLM-powered job matcher using OpenRouter
const axios = require('axios');

class LLMJobMatcher {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.enabled = !!apiKey && apiKey !== 'your_openrouter_api_key_here';
    this.model = 'meta-llama/llama-3.1-8b-instruct'; // Free model on OpenRouter - good at JSON
  }

  async enhanceJobMatching(jobs, profile) {
    if (!this.enabled) {
      console.log('LLM matching disabled (no API key)');
      return jobs;
    }

    console.log('🤖 Enhancing job matching with LLM...');

    const skillsList = profile.skills.join(', ');
    const locations = profile.locations;

    const enhancedJobs = [];
    
    for (const job of jobs) {
      try {
        const analysis = await this.analyzeJob(job, skillsList, locations);
        enhancedJobs.push({
          ...job,
          llmScore: analysis.score,
          llmRole: analysis.role,
          llmReasoning: analysis.reasoning,
          matchScore: job.matchScore + (analysis.score || 0)
        });
      } catch (error) {
        console.error(`LLM analysis failed for ${job.title}:`, error.message);
        enhancedJobs.push(job);
      }
    }

    return enhancedJobs;
  }

  async analyzeJob(job, skillsList, locations) {
    const prompt = `You are a job matching expert. Analyze this job posting and provide a JSON response.

Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Description: ${job.description || 'N/A'}

User Profile:
- Skills: ${skillsList}
- Preferred Locations: Regional Australia, Remote, Regional Victoria (NO metro cities)

Respond with ONLY a JSON object (no markdown):
{
  "score": <number 0-10 based on how well this job matches the profile>,
  "role": "<AI Engineer|Backend Engineer|Frontend Engineer|Fullstack Engineer|Mobile Engineer|General>",
  "reasoning": "<2 sentence explanation>"
}`;

    try {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 200
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com',
            'X-Title': 'Job Hunter'
          },
          timeout: 30000
        }
      );

      console.log(`LLM analysis complete for ${job.title} (status: ${response.data})`);

      // Safely extract content
      const choices = response.data?.choices;
      if (!choices || !Array.isArray(choices) || choices.length === 0) {
        console.log('LLM raw response:', JSON.stringify(response.data, null, 2));
        throw new Error('Invalid response: no choices');
      }
      
      const message = choices[0]?.message;
      if (!message) {
        console.log('LLM raw response:', JSON.stringify(response.data, null, 2));
        throw new Error('Invalid response: no message in choice');
      }
      
      // Some models (like StepFun) return content in 'reasoning' field
      let content = message.content;
      if (!content && message.reasoning) {
        content = message.reasoning;
      }
      
      if (!content) {
        console.log('LLM raw response:', JSON.stringify(response.data, null, 2));
        throw new Error('Invalid response: no content in message');
      }
      
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          throw new Error('Failed to parse JSON from LLM response: ' + parseError.message);
        }
      }
      
      throw new Error('No JSON found in LLM response');
    } catch (error) {
      // Log the error but re-throw it so batchAnalyze can handle it
      throw error;
    }
  }

  async batchAnalyze(jobs, profile, onProgress) {
    if (!this.enabled) return jobs;

    console.log(`🤖 Analyzing ${jobs.length} jobs with LLM...`);
    
    const enhancedJobs = [];
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      try {
        const analysis = await this.analyzeJob(job, profile.skills.join(', '), profile.locations);
        enhancedJobs.push({
          ...job,
          llmScore: analysis.score,
          llmRole: analysis.role,
          llmReasoning: analysis.reasoning,
          matchScore: job.matchScore + (analysis.score || 0)
        });
        
        if (onProgress) onProgress(i + 1, jobs.length);
        
        // Rate limiting - be nice to free API
        await new Promise(r => setTimeout(r, 500));
      } catch (error) {
        console.error(`LLM error for ${job.title}:`, error.message);
        enhancedJobs.push(job);
      }
    }

    return enhancedJobs;
  }
}

module.exports = LLMJobMatcher;
