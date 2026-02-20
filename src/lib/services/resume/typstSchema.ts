import { z } from 'zod';

/**
 * Zod schemas matching the NNJR Typst resume template's YAML structure.
 * See `vendor/NNJR/example.yml` for the reference shape.
 *
 * The LLM produces JSON conforming to this schema, which is then
 * serialised to YAML and compiled via `resume_yaml.typ`.
 */

export const typstPersonalSchema = z.object({
	name: z.string().describe('Full name of the candidate'),
	phone: z.string().optional().default('').describe('Phone number'),
	email: z.string().describe('Email address'),
	linkedin: z
		.string()
		.optional()
		.default('')
		.describe('LinkedIn URL (without https:// prefix, e.g. "linkedin.com/in/jane")'),
	site: z
		.string()
		.optional()
		.default('')
		.describe('Personal website or GitHub URL (without https:// prefix, e.g. "github.com/jane")')
});

export const typstEducationSchema = z.object({
	name: z.string().describe('University or school name'),
	degree: z.string().describe('Degree and major (e.g. "Bachelor of Science in Computer Science")'),
	location: z.string().optional().default('').describe('City, State'),
	date: z.string().describe('Date range (e.g. "Aug. 2018 - May 2022")')
});

export const typstExperienceSchema = z.object({
	role: z.string().describe('Job title / role held'),
	name: z.string().describe('Company or organisation name'),
	location: z.string().optional().default('').describe('City, State or "Remote"'),
	date: z.string().describe('Date range (e.g. "Jan. 2021 - Present")'),
	points: z
		.array(z.string())
		.min(1)
		.describe('Bullet-point achievements written in STAR format')
});

export const typstProjectSchema = z.object({
	name: z.string().describe('Project name'),
	skills: z
		.string()
		.describe('Comma-separated list of technologies used (e.g. "Python, Flask, React")'),
	date: z.string().describe('Date range (e.g. "Jun. 2020 - Present")'),
	points: z
		.array(z.string())
		.min(1)
		.describe('Bullet-point descriptions of what the project does / achieved')
});

export const typstSkillSchema = z.object({
	category: z.string().describe('Skill category label (e.g. "Languages", "Frameworks", "Tools")'),
	skills: z
		.string()
		.describe(
			'Comma-separated list of skills in this category (e.g. "Python, TypeScript, Go")'
		)
});

export const typstResumeDataSchema = z.object({
	personal: typstPersonalSchema.describe('Candidate contact information'),
	education: z
		.array(typstEducationSchema)
		.describe('Education entries, most recent first'),
	experience: z
		.array(typstExperienceSchema)
		.describe('Professional experience entries, most recent first'),
	projects: z
		.array(typstProjectSchema)
		.optional()
		.default([])
		.describe('Notable projects'),
	skills: z
		.array(typstSkillSchema)
		.describe('Technical skills grouped by category')
});

export type TypstResumeData = z.infer<typeof typstResumeDataSchema>;
