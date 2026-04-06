const JobHunter = require('./index');
const hunter = new JobHunter();
hunter.run().catch(console.error);