import { z } from 'zod';

/**
 * Zod schema matching the structured JSON that the LLM produces
 * for an ATS-friendly resume.  Mirrors the shape expected by the
 * default Handlebars template in `defaultTemplate.md`.
 */

export const experienceSchema = z.object({
	job_title: z.string().describe('Job title held at this position'),
	company: z.string().describe('Company or organisation name'),
	location: z.string().optional().default('').describe('City / remote'),
	start_date: z.string().describe('Start date (e.g. "Jan 2020")'),
	end_date: z.string().describe('End date or "Present"'),
	achievements: z
		.array(z.string())
		.describe('Bullet-point achievements written in STAR format')
});

export const educationSchema = z.object({
	degree: z.string().describe('Degree or qualification obtained'),
	institution: z.string().describe('University or school name'),
	location: z.string().optional().default('').describe('City / country'),
	graduation_date: z.string().describe('Graduation year or date')
});

export const certificationSchema = z.object({
	name: z.string().describe('Certification name'),
	issuer: z.string().optional().default('').describe('Issuing body'),
	date: z.string().optional().default('').describe('Date obtained')
});

export const projectSchema = z.object({
	name: z.string().describe('Project name'),
	description: z.string().describe('Brief description of the project'),
	technologies: z.array(z.string()).optional().default([]).describe('Technologies used')
});

export const resumeDataSchema = z.object({
	name: z.string().describe('Full name of the candidate'),
	professional_profile: z
		.string()
		.describe('A concise professional summary / profile paragraph'),
	skills: z.array(z.string()).describe('Flat list of relevant skills'),
	experience: z.array(experienceSchema).describe('Professional experience entries'),
	education: z.array(educationSchema).describe('Education entries'),
	certifications: z
		.array(certificationSchema)
		.optional()
		.default([])
		.describe('Professional certifications'),
	projects: z
		.array(projectSchema)
		.optional()
		.default([])
		.describe('Notable projects'),
	additional_info: z
		.record(z.string(), z.string())
		.optional()
		.default({})
		.describe('Key-value pairs of any extra relevant information')
});

export type ResumeData = z.infer<typeof resumeDataSchema>;
