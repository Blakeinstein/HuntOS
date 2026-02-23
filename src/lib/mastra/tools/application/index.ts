// src/lib/mastra/tools/application/index.ts
// Application-specific tools used by the job-application-agent during the
// apply pipeline. These tools allow the agent to persist discovered form
// fields and research resources back to the database as it works.

export { createLogFieldsTool } from './log-fields.js';
export { createLogResourceTool } from './log-resource.js';
export { createGetProfileTool as createGetApplicationProfileTool } from './get-profile.js';
