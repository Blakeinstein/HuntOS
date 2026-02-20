import { chromium, type Browser } from 'playwright';

// ── Types ────────────────────────────────────────────────────────

export interface PdfConversionOptions {
	/** Page format (default: 'Letter') */
	format?: 'Letter' | 'A4' | 'Legal';
	/** Top/bottom/left/right margins (default: '0.6in') */
	margin?: string;
	/** Whether to include page numbers in the footer (default: true) */
	pageNumbers?: boolean;
	/** Custom CSS to inject into the HTML before rendering */
	customCss?: string;
}

export interface PdfConversionResult {
	/** The raw PDF bytes */
	buffer: Buffer;
	/** Number of pages in the generated PDF */
	pageCount: number;
}

// ── Default resume CSS ───────────────────────────────────────────

const DEFAULT_RESUME_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root {
  --text-primary: #1a1a2e;
  --text-secondary: #4a4a6a;
  --text-muted: #7a7a9a;
  --accent: #2563eb;
  --border: #e2e8f0;
  --bg-subtle: #f8fafc;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 10.5pt;
  line-height: 1.5;
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}

h1 {
  font-size: 22pt;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4pt;
  letter-spacing: -0.02em;
  border-bottom: 2.5px solid var(--accent);
  padding-bottom: 6pt;
}

h2 {
  font-size: 12pt;
  font-weight: 700;
  color: var(--accent);
  margin-top: 14pt;
  margin-bottom: 6pt;
  padding-bottom: 3pt;
  border-bottom: 1px solid var(--border);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

h3 {
  font-size: 11pt;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 8pt;
  margin-bottom: 2pt;
}

p {
  margin-bottom: 4pt;
  color: var(--text-secondary);
}

ul {
  margin: 3pt 0 6pt 16pt;
  padding: 0;
}

li {
  margin-bottom: 2pt;
  color: var(--text-secondary);
  line-height: 1.45;
}

li::marker {
  color: var(--accent);
}

strong {
  font-weight: 600;
  color: var(--text-primary);
}

em {
  font-style: italic;
  color: var(--text-muted);
}

code {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 9pt;
  background: var(--bg-subtle);
  padding: 1pt 4pt;
  border-radius: 3pt;
  border: 1px solid var(--border);
}

a {
  color: var(--accent);
  text-decoration: none;
}

hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 10pt 0;
}

/* Emoji location/date markers */
p:has(> img[alt="📍"]),
h3 + p {
  font-size: 9.5pt;
  color: var(--text-muted);
}
`;

// ── Markdown → HTML conversion ───────────────────────────────────

/**
 * Lightweight Markdown → HTML converter for resume content.
 *
 * Handles the subset of Markdown produced by the Handlebars templates:
 * headings, bold, italic, lists, links, horizontal rules, paragraphs.
 *
 * This intentionally avoids pulling in a heavy dependency like
 * marked/remark just for resume rendering.
 */
function markdownToHtml(md: string): string {
	const lines = md.split('\n');
	const htmlLines: string[] = [];
	let inList = false;

	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];

		// Horizontal rule
		if (/^[-*_]{3,}\s*$/.test(line)) {
			if (inList) {
				htmlLines.push('</ul>');
				inList = false;
			}
			htmlLines.push('<hr />');
			continue;
		}

		// Headings
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			if (inList) {
				htmlLines.push('</ul>');
				inList = false;
			}
			const level = headingMatch[1].length;
			const text = inlineFormat(headingMatch[2]);
			htmlLines.push(`<h${level}>${text}</h${level}>`);
			continue;
		}

		// Unordered list items (- or *)
		const listMatch = line.match(/^[\s]*[*-]\s+(.+)$/);
		if (listMatch) {
			if (!inList) {
				htmlLines.push('<ul>');
				inList = true;
			}
			htmlLines.push(`<li>${inlineFormat(listMatch[1])}</li>`);
			continue;
		}

		// Close list if we hit a non-list line
		if (inList && line.trim() === '') {
			htmlLines.push('</ul>');
			inList = false;
			continue;
		}

		if (inList && !listMatch) {
			htmlLines.push('</ul>');
			inList = false;
		}

		// Empty line — skip (paragraph spacing handled by CSS)
		if (line.trim() === '') {
			continue;
		}

		// Regular paragraph
		htmlLines.push(`<p>${inlineFormat(line)}</p>`);
	}

	if (inList) {
		htmlLines.push('</ul>');
	}

	return htmlLines.join('\n');
}

/**
 * Convert inline Markdown formatting to HTML.
 */
function inlineFormat(text: string): string {
	return (
		text
			// Bold
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			// Italic
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			// Inline code
			.replace(/`(.+?)`/g, '<code>$1</code>')
			// Links
			.replace(
				/\[([^\]]+)\]\(([^)]+)\)/g,
				'<a href="$2" target="_blank" rel="noopener">$1</a>'
			)
	);
}

// ── Service ──────────────────────────────────────────────────────

/**
 * Converts Markdown resumes to PDF using Playwright's Chromium.
 *
 * The service manages a singleton browser instance that is lazily
 * initialised and reused across requests for efficiency.
 *
 * Pipeline: Markdown → HTML → CSS-styled page → Chromium PDF print
 */
export class PdfService {
	private browser: Browser | null = null;
	private launching: Promise<Browser> | null = null;

	// ── Public API ────────────────────────────────────────────────

	/**
	 * Convert a Markdown string to a PDF buffer.
	 */
	async markdownToPdf(
		markdown: string,
		options: PdfConversionOptions = {}
	): Promise<PdfConversionResult> {
		const {
			format = 'Letter',
			margin = '0.6in',
			pageNumbers = true,
			customCss = ''
		} = options;

		const html = this.buildHtmlDocument(markdown, customCss);
		const browser = await this.getBrowser();
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			await page.setContent(html, { waitUntil: 'networkidle' });

			// Small delay for web font loading
			await page.waitForTimeout(300);

			const pdfBuffer = await page.pdf({
				format,
				margin: {
					top: margin,
					bottom: pageNumbers ? '0.8in' : margin,
					left: margin,
					right: margin
				},
				printBackground: true,
				preferCSSPageSize: false,
				...(pageNumbers
					? {
							displayHeaderFooter: true,
							headerTemplate: '<span></span>',
							footerTemplate: `
							<div style="width: 100%; font-size: 8pt; color: #999; text-align: center; padding: 0 0.6in;">
								<span class="pageNumber"></span> / <span class="totalPages"></span>
							</div>`
						}
					: {})
			});

			// Estimate page count from PDF (simple heuristic: check /Type /Page occurrences)
			const pdfString = pdfBuffer.toString('latin1');
			const pageMatches = pdfString.match(/\/Type\s*\/Page(?!\s*s)/g);
			const pageCount = pageMatches ? pageMatches.length : 1;

			return {
				buffer: Buffer.from(pdfBuffer),
				pageCount
			};
		} finally {
			await context.close();
		}
	}

	/**
	 * Close the browser instance. Call this during app shutdown.
	 */
	async close(): Promise<void> {
		if (this.browser) {
			await this.browser.close();
			this.browser = null;
			this.launching = null;
		}
	}

	// ── Internals ─────────────────────────────────────────────────

	/**
	 * Get or launch the singleton Chromium browser.
	 * Serialises concurrent launch attempts.
	 */
	private async getBrowser(): Promise<Browser> {
		if (this.browser?.isConnected()) {
			return this.browser;
		}

		if (this.launching) {
			return this.launching;
		}

		this.launching = chromium
			.launch({
				headless: true,
				args: [
					'--no-sandbox',
					'--disable-setuid-sandbox',
					'--disable-gpu',
					'--disable-dev-shm-usage',
					'--font-render-hinting=none'
				]
			})
			.then((browser) => {
				this.browser = browser;
				this.launching = null;

				// Auto-clean up on unexpected disconnect
				browser.on('disconnected', () => {
					this.browser = null;
					this.launching = null;
				});

				return browser;
			})
			.catch((err) => {
				this.launching = null;
				throw err;
			});

		return this.launching;
	}

	/**
	 * Wrap the converted HTML in a full document with the resume stylesheet.
	 */
	private buildHtmlDocument(markdown: string, customCss: string): string {
		const bodyHtml = markdownToHtml(markdown);

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${DEFAULT_RESUME_CSS}</style>
  ${customCss ? `<style>${customCss}</style>` : ''}
</head>
<body>
  <main>${bodyHtml}</main>
</body>
</html>`;
	}
}
