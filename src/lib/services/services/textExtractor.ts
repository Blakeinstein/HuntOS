// src/lib/services/services/textExtractor.ts
// Service for extracting text content from various file formats.
// Supports PDF, DOCX, and plain text formats.

import { readFileSync } from 'fs';

// ── Types ───────────────────────────────────────────────────────────

export interface ExtractionResult {
	text: string;
	metadata: {
		pageCount?: number;
		title?: string;
		author?: string;
		format: string;
	};
}

export type SupportedFormat = 'pdf' | 'docx' | 'doc' | 'txt' | 'md' | 'html' | 'json' | 'csv';

// ── Service ─────────────────────────────────────────────────────────

export class TextExtractor {
	/**
	 * Extract text from a file buffer based on its MIME type or filename.
	 */
	async extract(buffer: Buffer, filename: string, mimeType?: string): Promise<ExtractionResult> {
		const format = this.detectFormat(filename, mimeType);

		switch (format) {
			case 'pdf':
				return this.extractPdf(buffer);
			case 'docx':
			case 'doc':
				return this.extractDocx(buffer);
			case 'html':
				return this.extractHtml(buffer);
			case 'json':
				return this.extractJson(buffer);
			case 'csv':
				return this.extractCsv(buffer);
			case 'md':
			case 'txt':
			default:
				return this.extractPlainText(buffer, format);
		}
	}

	/**
	 * Extract text from a file path.
	 */
	async extractFromPath(filePath: string, mimeType?: string): Promise<ExtractionResult> {
		const buffer = readFileSync(filePath);
		const filename = filePath.split('/').pop() || 'unknown';
		return this.extract(Buffer.from(buffer), filename, mimeType);
	}

	/**
	 * Check if a file format is supported for text extraction.
	 */
	isSupported(filename: string, mimeType?: string): boolean {
		try {
			this.detectFormat(filename, mimeType);
			return true;
		} catch {
			return false;
		}
	}

	// ── Format Detection ────────────────────────────────────────────

	private detectFormat(filename: string, mimeType?: string): SupportedFormat {
		const lower = filename.toLowerCase();
		const mime = mimeType?.toLowerCase() || '';

		if (mime.includes('pdf') || lower.endsWith('.pdf')) return 'pdf';
		if (
			mime.includes('wordprocessingml') ||
			mime.includes('msword') ||
			lower.endsWith('.docx')
		)
			return 'docx';
		if (lower.endsWith('.doc')) return 'doc';
		if (mime.includes('html') || lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
		if (mime.includes('json') || lower.endsWith('.json')) return 'json';
		if (mime.includes('csv') || lower.endsWith('.csv')) return 'csv';
		if (lower.endsWith('.md') || lower.endsWith('.mdx') || mime.includes('markdown')) return 'md';

		// Default to plain text for anything else
		return 'txt';
	}

	// ── Extractors ──────────────────────────────────────────────────

	private async extractPdf(buffer: Buffer): Promise<ExtractionResult> {
		try {
			// pdf-parse-new works with Bun and doesn't require the test file workaround
			const pdfParse = (await import('pdf-parse-new')).default;

			const data = await pdfParse(buffer);

			const text = data.text?.trim() || '';

			if (!text) {
				return {
					text: '[PDF contained no extractable text - it may be a scanned/image-based PDF]',
					metadata: {
						pageCount: data.numpages,
						format: 'pdf'
					}
				};
			}

			return {
				text: this.cleanText(text),
				metadata: {
					pageCount: data.numpages,
					title: data.info?.Title || undefined,
					author: data.info?.Author || undefined,
					format: 'pdf'
				}
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to extract text from PDF: ${message}`);
		}
	}

	private async extractDocx(buffer: Buffer): Promise<ExtractionResult> {
		try {
			const mammoth = await import('mammoth');

			// mammoth.extractRawText gives us plain text without HTML formatting
			const result = await mammoth.extractRawText({ buffer });
			const text = result.value?.trim() || '';

			if (!text) {
				return {
					text: '[DOCX contained no extractable text]',
					metadata: { format: 'docx' }
				};
			}

			return {
				text: this.cleanText(text),
				metadata: { format: 'docx' }
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to extract text from DOCX: ${message}`);
		}
	}

	private extractHtml(buffer: Buffer): ExtractionResult {
		const raw = buffer.toString('utf-8');

		// Strip HTML tags for plain text extraction
		const text = raw
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&quot;/gi, '"')
			.replace(/&#39;/gi, "'");

		return {
			text: this.cleanText(text),
			metadata: { format: 'html' }
		};
	}

	private extractJson(buffer: Buffer): ExtractionResult {
		const raw = buffer.toString('utf-8');

		try {
			// Pretty-print the JSON for readability
			const parsed = JSON.parse(raw);
			const text = JSON.stringify(parsed, null, 2);

			return {
				text,
				metadata: { format: 'json' }
			};
		} catch {
			// If it's not valid JSON, just return as-is
			return {
				text: raw.trim(),
				metadata: { format: 'json' }
			};
		}
	}

	private extractCsv(buffer: Buffer): ExtractionResult {
		const raw = buffer.toString('utf-8');

		return {
			text: raw.trim(),
			metadata: { format: 'csv' }
		};
	}

	private extractPlainText(buffer: Buffer, format: string): ExtractionResult {
		const text = buffer.toString('utf-8');

		return {
			text: this.cleanText(text),
			metadata: { format }
		};
	}

	// ── Helpers ─────────────────────────────────────────────────────

	/**
	 * Clean extracted text: normalize whitespace, remove excessive blank lines.
	 */
	private cleanText(text: string): string {
		return (
			text
				// Normalize various whitespace characters to regular spaces
				.replace(/[\t\f\v]+/g, ' ')
				// Collapse multiple spaces into one
				.replace(/ {2,}/g, ' ')
				// Collapse 3+ newlines into 2
				.replace(/\n{3,}/g, '\n\n')
				// Trim each line
				.split('\n')
				.map((line) => line.trim())
				.join('\n')
				.trim()
		);
	}
}
