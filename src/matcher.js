const fs = require('fs');
const path = require('path');

class JobMatcher {
  constructor(profile) {
    this.skills = profile.skills || [];
    this.locations = profile.locations || {};
    this.maxResults = profile.maxResults || 100;
    this.minMatchScore = profile.minMatchScore || 1;
    
    // Define role categories with their key skills (priority order)
    this.roleCategories = {
      'AI Engineer': ['ai', 'rag', 'langchain', 'machine learning', 'ml', 'llm', 'gpt', 'claude', 'openai', 'nlp', 'neural', 'deep learning', 'artificial intelligence'],
      'Backend Engineer': ['backend', 'api', 'spring', 'boot', 'node', 'python', 'java', 'django', 'express', 'rails', 'go', 'rust', 'database', 'sql', 'postgres', 'mysql', 'mongodb', 'aws', 'cloud', 'server', 'microservice'],
      'Frontend Engineer': ['react', 'react native', 'frontend', 'front-end', 'vue', 'angular', 'javascript', 'typescript', 'css', 'html', 'next.js', 'nextjs', 'ui', 'ux'],
      'Fullstack Engineer': ['fullstack', 'full-stack', 'full stack', 'node', 'python', 'react', 'angular', 'vue', 'aws', 'docker', 'kubernetes']
    };
    
    // Regional Victoria locations (highest priority)
    this.regionalVictoriaLocations = [
      'geelong', 'bendigo', 'ballarat', 'albury', 'mildura', 'shepparton', 'warrnambool',
      'maldon', 'castlemaine', 'kyneton', 'wangaratta', 'swan hill', 'horsham', 'stawell',
      'maryborough', 'ararat', 'sale', 'bairnsdale', 'orbost', 'wonthaggi', 'leongatha',
      'portland', 'hamilton', 'clunes', 'daylesford', 'traralgon'
    ];
    
    // All regional Australia locations
    this.regionalAustraliaLocations = [
      'regional', 'regional nsw', 'regional vic', 'regional qld', 'regional wa', 'regional sa', 'regional tas', 'regional nt',
      'newcastle', 'wollongong', 'sunshine coast', 'toowoomba', 'townsville', 'cairns',
      'bathurst', 'orange', 'dubbo', 'coffs harbour', 'port macquarie', 'tamworth', 'wagga wagga',
      'albury wodonga'
    ];
  }

  matchJobs(jobs) {
    console.log(`Matching ${jobs.length} jobs against profile...`);

    const matched = jobs
      .map(job => this.scoreJob(job))
      .filter(job => job.matchScore >= this.minMatchScore)
      .sort((a, b) => {
        // Primary sort: location priority (regional first, then remote)
        const locationOrder = this.getLocationPriority(b.location) - this.getLocationPriority(a.location);
        if (locationOrder !== 0) return locationOrder;
        
        // Secondary sort: role priority (AI > Backend > Fullstack > Frontend > General)
        const roleOrder = this.getRolePriority(b.roleCategory) - this.getRolePriority(a.roleCategory);
        if (roleOrder !== 0) return roleOrder;
        
        // Tertiary sort: match score
        return b.matchScore - a.matchScore;
      })
      .slice(0, this.maxResults);

    console.log(`Filtered to ${matched.length} matching jobs (min score: ${this.minMatchScore})`);
    
    // Log breakdowns
    this.logRoleBreakdown(matched);
    this.logLocationBreakdown(matched);
    
    return matched;
  }

  // Location priority: higher = better
  getLocationPriority(locationStr) {
    const loc = (locationStr || '').toLowerCase();
    
    // Highest: Regional Victoria
    for (const vic of this.regionalVictoriaLocations) {
      if (loc.includes(vic)) return 100;
    }
    
    // High: Other Regional Australia
    for (const regional of this.regionalAustraliaLocations) {
      if (loc.includes(regional)) return 80;
    }
    
    // Medium: Remote
    if (loc.includes('remote') || loc.includes('work from home') || loc.includes('wfh') || loc.includes('anywhere')) {
      return 60;
    }
    
    // Low: Default/neutral
    return 10;
  }

  // Role priority: higher = better
  getRolePriority(role) {
    const priorities = {
      'AI Engineer': 40,
      'Backend Engineer': 30,
      'Fullstack Engineer': 25,
      'Frontend Engineer': 20,
      'Mobile Engineer': 15,
      'General': 5
    };
    return priorities[role] || 0;
  }

  logLocationBreakdown(matchedJobs) {
    const breakdown = { 'Regional Victoria': 0, 'Regional Australia': 0, 'Remote': 0, 'Other': 0 };
    matchedJobs.forEach(job => {
      const loc = (job.location || '').toLowerCase();
      if (this.regionalVictoriaLocations.some(v => loc.includes(v))) {
        breakdown['Regional Victoria']++;
      } else if (this.regionalAustraliaLocations.some(r => loc.includes(r))) {
        breakdown['Regional Australia']++;
      } else if (loc.includes('remote') || loc.includes('wfh')) {
        breakdown['Remote']++;
      } else {
        breakdown['Other']++;
      }
    });
    console.log('Location breakdown:', breakdown);
  }

  // Determine role category based on skill matches
  getRoleCategory(job, matchedSkills) {
    const titleLower = (job.title || '').toLowerCase();
    // Use description if available, otherwise just use title
    const descriptionLower = (job.description || '').toLowerCase();
    const combinedText = titleLower + ' ' + descriptionLower;
    
    const skillMatchCount = matchedSkills.length;
    const totalSkills = this.skills.length;
    const matchPercentage = (skillMatchCount / totalSkills) * 100;
    
    // Count matches per role category based on job title and matched profile skills
    const roleMatchCounts = {};
    for (const [role, roleSkills] of Object.entries(this.roleCategories)) {
      let matches = 0;
      for (const roleSkill of roleSkills) {
        // Check both in job title/description AND in matched profile skills
        if (combinedText.includes(roleSkill.toLowerCase())) {
          matches++;
        }
        // Also check if any profile skill matches this role category
        for (const skill of matchedSkills) {
          if (skill.toLowerCase().includes(roleSkill.toLowerCase())) {
            matches++;
          }
        }
      }
      roleMatchCounts[role] = matches;
    }
    
    // AI Engineer: AI-related keywords in title OR strong AI skill match
    if (titleLower.includes('ai') || titleLower.includes('machine learning') || titleLower.includes('ml') || 
        titleLower.includes('rag') || titleLower.includes('nlp') || titleLower.includes('llm') ||
        roleMatchCounts['AI Engineer'] >= 2 || matchPercentage > 50) {
      return 'AI Engineer';
    }
    
    // Frontend Engineer: >80% profile match with frontend skills OR strong frontend in title
    if (matchPercentage > 80 || titleLower.includes('frontend') || titleLower.includes('front-end') ||
        titleLower.includes('react') || titleLower.includes('react native') || titleLower.includes('vue') ||
        roleMatchCounts['Frontend Engineer'] >= 4) {
      return 'Frontend Engineer';
    }
    
    // Backend Engineer: >50% profile match OR backend-related keywords in title
    if (matchPercentage > 50 || titleLower.includes('backend') || titleLower.includes('back-end') ||
        titleLower.includes('api') || titleLower.includes('server') ||
        roleMatchCounts['Backend Engineer'] >= 3) {
      return 'Backend Engineer';
    }
    
    // Fullstack Engineer: has fullstack in title OR both frontend + backend indicators
    if (titleLower.includes('fullstack') || titleLower.includes('full-stack') || titleLower.includes('full stack')) {
      return 'Fullstack Engineer';
    }
    
    // React Native specific - classify as Mobile/Frontend
    if (titleLower.includes('mobile') || titleLower.includes('react native')) {
      return 'Mobile Engineer';
    }
    
    // Default to General based on matched skills
    return 'General';
  }

  logRoleBreakdown(matchedJobs) {
    const breakdown = {};
    matchedJobs.forEach(job => {
      const role = job.roleCategory || 'General';
      breakdown[role] = (breakdown[role] || 0) + 1;
    });
    console.log('Role breakdown:', breakdown);
  }

  scoreJob(job) {
    let score = 0;
    const matchedSkills = [];
    const matches = {
      skills: [],
      locationType: '',
      notes: []
    };

    const title = (job.title || '').toLowerCase();
    const description = (job.description || '').toLowerCase();
    const location = (job.location || '').toLowerCase();

    // Skill matching
    for (const skill of this.skills) {
      const skillLower = skill.toLowerCase();
      const skillWords = skillLower.split(/\s+/);

      // Check if all words in multi-word skill are present
      const allWordsPresent = skillWords.every(word =>
        title.includes(word) || description.includes(word)
      );

      // Bonus for exact phrase match in title
      if (title.includes(skillLower)) {
        score += 3;
        matchedSkills.push(skill);
        matches.skills.push({ skill, weight: 3, location: 'title' });
      } else if (allWordsPresent) {
        score += 2;
        matchedSkills.push(skill);
        matches.skills.push({ skill, weight: 2, location: 'title/description' });
      } else if (description.includes(skillLower)) {
        score += 1;
        matchedSkills.push(skill);
        matches.skills.push({ skill, weight: 1, location: 'description' });
      }
    }

    // Location matching
    const locationInfo = this.scoreLocation(location, job.location);
    score += locationInfo.score;
    matches.locationType = locationInfo.type;
    if (locationInfo.notes) {
      matches.notes.push(...locationInfo.notes);
    }

    // Determine role category
    const roleCategory = this.getRoleCategory(job, matchedSkills);

    return {
      ...job,
      matchScore: score,
      roleCategory: roleCategory,
      matchedSkills: matchedSkills,
      matchDetails: matches,
      rankedAt: new Date().toISOString()
    };
  }

  scoreLocation(locationStr, originalLocation) {
    let score = 0;
    let type = 'unknown';
    const notes = [];
    const locLower = locationStr.toLowerCase();

    // Check exclusions (metro cities)
    if (this.locations.exclude) {
      for (const excluded of this.locations.exclude) {
        if (locLower.includes(excluded.toLowerCase())) {
          score -= 5;
          type = 'excluded';
          notes.push(`Excluded location: ${excluded}`);
          return { score, type, notes };
        }
      }
    }

    // Check inclusions (remote/regional)
    if (this.locations.include) {
      for (const included of this.locations.include) {
        if (locLower.includes(included.toLowerCase())) {
          score += 3;
          type = 'included';
          notes.push(`Included location: ${included}`);
          break;
        }
      }
    }

    // Check for remote indicators
    const remoteIndicators = ['remote', 'work from home', 'wfh', 'anywhere', 'distributed'];
    if (remoteIndicators.some(indicator => locLower.includes(indicator))) {
      score += 2;
      type = 'remote';
      notes.push('Remote work');
    }

    // Default case
    if (type === 'unknown') {
      score += 1; // Neutral score if not explicitly excluded
      type = 'neutral';
      notes.push('Location not explicitly filtered');
    }

    return { score, type, notes };
  }

  generateSummary(matchedJobs) {
    const bySource = {};
    const byScore = { high: 0, medium: 0, low: 0 };
    const locationTypes = {};
    const locationBreakdown = { 'Regional Victoria': 0, 'Regional Australia': 0, 'Remote': 0, 'Other': 0 };

    matchedJobs.forEach(job => {
      bySource[job.source] = (bySource[job.source] || 0) + 1;

      if (job.matchScore >= 5) byScore.high++;
      else if (job.matchScore >= 3) byScore.medium++;
      else byScore.low++;

      const locType = job.matchDetails?.locationType || 'unknown';
      locationTypes[locType] = (locationTypes[locType] || 0) + 1;
      
      // Calculate location breakdown
      const loc = (job.location || '').toLowerCase();
      if (this.regionalVictoriaLocations.some(v => loc.includes(v))) {
        locationBreakdown['Regional Victoria']++;
      } else if (this.regionalAustraliaLocations.some(r => loc.includes(r))) {
        locationBreakdown['Regional Australia']++;
      } else if (loc.includes('remote') || loc.includes('wfh')) {
        locationBreakdown['Remote']++;
      } else {
        locationBreakdown['Other']++;
      }
    });

    return {
      total: matchedJobs.length,
      bySource,
      byScore,
      locationTypes,
      locationBreakdown,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = JobMatcher;