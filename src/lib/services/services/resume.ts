import type { Database } from './database';
import { ProfileService, type ProfileData } from './profile';

export interface Resume {
	id: number;
	application_id: number;
	content: string;
	job_description_hash: string;
	created_at: string;
}

export interface ResumeGenerationOptions {
	format?: 'markdown' | 'html' | 'pdf';
	includeSections?: string[];
	targetJobTitle?: string;
}

export class ResumeService {
	private db: Database;
	private profileService: ProfileService;

	constructor(db: Database, profileService: ProfileService) {
		this.db = db;
		this.profileService = profileService;
	}

	/**
	 * Generate a tailored resume
	 */
	async generateResume(jobDescription: string, customProfile?: ProfileData): Promise<string> {
		const profile = customProfile || (await this.profileService.getProfile());

		const resumeContent = this.createResumeMarkdown(profile, jobDescription);

		return resumeContent;
	}

	/**
	 * Save resume version
	 */
	async saveResume(
		applicationId: number,
		content: string,
		jobDescriptionHash: string
	): Promise<number> {
		const result = await this.db.run(
			`
      INSERT INTO resumes (application_id, content, job_description_hash, created_at)
      VALUES (?, ?, ?, datetime('now'))
      `,
			[applicationId, content, jobDescriptionHash]
		);

		return Number(result.lastInsertRowid);
	}

	/**
	 * Get resume for application
	 */
	async getResume(applicationId: number): Promise<Resume | null> {
		return this.db.get(
			`SELECT * FROM resumes WHERE application_id = ? ORDER BY created_at DESC LIMIT 1`,
			[applicationId]
		);
	}

	/**
	 * Get all resume versions for application
	 */
	async getResumeHistory(applicationId: number): Promise<Resume[]> {
		return this.db.all(`SELECT * FROM resumes WHERE application_id = ? ORDER BY created_at DESC`, [
			applicationId
		]);
	}

	/**
	 * Calculate resume match score
	 */
	calculateMatchScore(resume: string, jobDescription: string): number {
		const resumeWords = this.tokenize(resume.toLowerCase());
		const jobWords = this.tokenize(jobDescription.toLowerCase());

		const jobWordSet = new Set(jobWords);
		let matchCount = 0;

		for (const word of resumeWords) {
			if (jobWordSet.has(word)) {
				matchCount++;
			}
		}

		if (jobWordSet.size === 0) return 0;
		return Math.round((matchCount / jobWordSet.size) * 100);
	}

	/**
	 * Tokenize text into words
	 */
	private tokenize(text: string): string[] {
		return text
			.replace(/[^\w\s]/g, ' ')
			.toLowerCase()
			.split(/\s+/)
			.filter((word) => word.length > 2)
			.filter((word, index, self) => self.indexOf(word) === index);
	}

	/**
	 * Create resume markdown
	 */
	private createResumeMarkdown(profile: ProfileData, jobDescription: string): string {
		const name = profile.name || 'Your Name';
		const email = profile.email || 'your.email@example.com';
		const phone = profile.phone || 'Your Phone Number';
		const location = profile.location || 'Your City, State';
		const linkedin = profile.linkedin_url || '';
		const portfolio = profile.portfolio_url || '';

		const summary = profile.resume_summary || this.generateSummary(profile, jobDescription);
		const skills = this.formatSkills(profile.skills || []);
		const experience = profile.experience || this.generateExperienceSection(profile);
		const education = profile.education || this.generateEducationSection(profile);

		let markdown = `---
job_title: ${(Array.isArray(profile.job_titles) && profile.job_titles[0]) || 'Professional'}
date: ${new Date().toLocaleDateString()}
---

# ${name}

${email} | ${phone} | ${location}
${linkedin ? `| [LinkedIn](${linkedin})` : ''}
${portfolio ? `| [Portfolio](${portfolio})` : ''}

## Summary

${summary}

## Skills

${skills}

## Experience

${experience}

## Education

${education}

## Certifications

${Array.isArray(profile.certifications) ? profile.certifications.join(', ') : profile.certifications || 'Not specified'}

## Languages

${Array.isArray(profile.languages) ? profile.languages.join(', ') : profile.languages || 'Not specified'}
`;

		return markdown;
	}

	/**
	 * Generate professional summary
	 */
	private generateSummary(profile: ProfileData, jobDescription: string): string {
		// Placeholder summary generation
		const years = (profile.experience as string)?.match(/\d+/)?.[0] || '5';
		const skills = Array.isArray(profile.skills)
			? profile.skills.slice(0, 3).join(', ')
			: String(profile.skills || '')
					.split(',')
					.slice(0, 3)
					.join(', ');

		return `Results-driven professional with ${years}+ years of experience in ${skills}. Proven track record of delivering high-quality results in fast-paced environments. Skilled in leveraging technical expertise and industry knowledge to drive business growth and operational excellence.`;
	}

	/**
	 * Format skills section
	 */
	private formatSkills(skills: string | string[]): string {
		const skillList = Array.isArray(skills) ? skills : skills.split(',').map((s) => s.trim());
		return skillList.map((skill) => `• ${skill}`).join('\n');
	}

	/**
	 * Generate experience section
	 */
	private generateExperienceSection(profile: ProfileData): string {
		// In a real implementation, this would use actual experience data from the profile
		return `**Senior Professional**\n
Company Name, City, State\n
${new Date().getFullYear() - 5} - Present\n
• Led multiple successful projects from inception to completion\n
• Collaborated with cross-functional teams to deliver high-quality results\n
• Implemented process improvements that increased efficiency by X%\n
• Mentored junior team members and contributed to team development`;
	}

	/**
	 * Generate education section
	 */
	private generateEducationSection(profile: ProfileData): string {
		// In a real implementation, this would use actual education data from the profile
		return `**Bachelor of Science in Field of Study**\n
University Name, City, State\n
Graduated: ${new Date().getFullYear() - 5}\n
• Relevant coursework: Course 1, Course 2, Course 3\n
• Achievements: Dean's List, Academic Awards`;
	}
}
