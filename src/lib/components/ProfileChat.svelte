<script lang="ts" module>
	/**
	 * Simple markdown-ish formatting for chat messages.
	 * Handles bold, italic, inline code, links, and line breaks.
	 * Input is escaped first to prevent XSS via {@html}.
	 */
	function formatMessageText(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			.replace(/`(.+?)`/g, '<code class="rounded bg-surface-200-800 px-1 py-0.5 text-xs">$1</code>')
			.replace(
				/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
				'<a href="$2" target="_blank" rel="noopener" class="underline text-primary-500">$1</a>'
			)
			.replace(/\n/g, '<br />');
	}
</script>

<script lang="ts">
	import { Chat, type UIMessage } from '@ai-sdk/svelte';
	import { DefaultChatTransport, isToolUIPart, type DynamicToolUIPart } from 'ai';
	import { invalidate } from '$app/navigation';
	import {
		SendIcon,
		BotIcon,
		UserIcon,
		LoaderIcon,
		AlertCircleIcon,
		CheckCircleIcon,
		WrenchIcon,
		RotateCcwIcon,
		StopCircleIcon,
		PaperclipIcon,
		GlobeIcon,
		XIcon,
		FileIcon,
		LinkIcon
	} from '@lucide/svelte';

	const chat = new Chat({
		id: 'profile-builder',
		transport: new DefaultChatTransport({
			api: '/api/chat/profile'
		}),
		onFinish() {
			// Refresh profile data in the page server load when assistant finishes
			invalidate('db:profile');
			invalidate('db:documents');
		},
		onError(error) {
			console.error('Profile chat error:', error);
		}
	});

	let inputValue = $state('');
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let messagesEndEl = $state<HTMLDivElement | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	// Attachment state
	let pendingFiles = $state<File[]>([]);
	let showUrlInput = $state(false);
	let urlInputValue = $state('');
	let pendingUrls = $state<{ url: string; title: string }[]>([]);
	let isUploadingAttachments = $state(false);
	let attachmentError = $state('');

	const messages = $derived(chat.messages);
	const status = $derived(chat.status);
	const error = $derived(chat.error);
	const isLoading = $derived(status === 'streaming' || status === 'submitted');

	const hasPendingAttachments = $derived(pendingFiles.length > 0 || pendingUrls.length > 0);
	const canSend = $derived(
		(inputValue.trim().length > 0 || hasPendingAttachments) && !isLoading && !isUploadingAttachments
	);

	// Load existing messages on mount
	$effect(() => {
		loadExistingMessages();
	});

	// Auto-scroll when messages change
	$effect(() => {
		if (messages.length > 0) {
			scrollToBottom();
		}
	});

	async function loadExistingMessages() {
		try {
			const res = await fetch('/api/chat/profile');
			if (res.ok) {
				const existing: UIMessage[] = await res.json();
				if (existing.length > 0) {
					chat.messages = existing;
				}
			}
		} catch (err) {
			console.error('Failed to load existing chat messages:', err);
		}
	}

	function scrollToBottom() {
		requestAnimationFrame(() => {
			messagesEndEl?.scrollIntoView({ behavior: 'smooth' });
		});
	}

	function handleFileSelect() {
		fileInputEl?.click();
	}

	function handleFileInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files) return;

		attachmentError = '';
		for (const file of input.files) {
			// Avoid duplicates
			if (!pendingFiles.some((f) => f.name === file.name && f.size === file.size)) {
				pendingFiles = [...pendingFiles, file];
			}
		}
		input.value = '';
	}

	function removePendingFile(index: number) {
		pendingFiles = pendingFiles.filter((_, i) => i !== index);
	}

	function toggleUrlInput() {
		showUrlInput = !showUrlInput;
		urlInputValue = '';
		attachmentError = '';
	}

	function addPendingUrl() {
		const url = urlInputValue.trim();
		if (!url) return;

		// Validate URL
		try {
			new URL(url);
		} catch {
			attachmentError = 'Please enter a valid URL (e.g. https://example.com)';
			return;
		}

		// Avoid duplicates
		if (pendingUrls.some((u) => u.url === url)) {
			attachmentError = 'This URL has already been added';
			return;
		}

		attachmentError = '';
		const title = extractTitleFromUrl(url);
		pendingUrls = [...pendingUrls, { url, title }];
		urlInputValue = '';
		showUrlInput = false;
	}

	function handleUrlKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addPendingUrl();
		}
		if (e.key === 'Escape') {
			showUrlInput = false;
			urlInputValue = '';
		}
	}

	function removePendingUrl(index: number) {
		pendingUrls = pendingUrls.filter((_, i) => i !== index);
	}

	function extractTitleFromUrl(url: string): string {
		try {
			const parsed = new URL(url);
			const host = parsed.hostname.replace('www.', '');
			const knownTitles: Record<string, string> = {
				'github.com': 'GitHub',
				'linkedin.com': 'LinkedIn',
				'gitlab.com': 'GitLab',
				'stackoverflow.com': 'Stack Overflow',
				'dev.to': 'Dev.to',
				'medium.com': 'Medium',
				'behance.net': 'Behance',
				'dribbble.com': 'Dribbble'
			};
			return knownTitles[host] || host;
		} catch {
			return 'Website';
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	/**
	 * Upload pending files and URLs, then compose a chat message that
	 * references them so the agent can analyze the content.
	 */
	async function processAttachments(): Promise<string> {
		const parts: string[] = [];

		// Process file uploads
		if (pendingFiles.length > 0) {
			isUploadingAttachments = true;

			for (const file of pendingFiles) {
				try {
					const formData = new FormData();
					formData.append('file', file);

					const res = await fetch('/api/user-resources', {
						method: 'POST',
						body: formData
					});

					if (!res.ok) {
						const data = await res.json();
						throw new Error(data.error || `Failed to upload ${file.name}`);
					}

					const result = await res.json();

					// Use server-extracted text (handles PDF, DOCX, etc.) instead of raw file.text()
					const fileText: string = result.extractedText || '';
					const truncated =
						fileText.length > 20_000
							? fileText.substring(0, 20_000) + '\n\n[... content truncated ...]'
							: fileText;

					const formatInfo = result.extraction?.format
						? ` [${result.extraction.format.toUpperCase()}]`
						: '';
					const pageInfo = result.extraction?.pageCount
						? `, ${result.extraction.pageCount} page(s)`
						: '';

					parts.push(
						`📎 **Uploaded file: ${result.filename}**${formatInfo} (${formatBytes(file.size)}${pageInfo})\n\n` +
							`Here is the extracted content of the file:\n\n${truncated}`
					);
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Upload failed';
					parts.push(`⚠️ Failed to upload "${file.name}": ${msg}`);
				}
			}

			// Invalidate documents so the Documents tab updates
			await invalidate('db:documents');
			isUploadingAttachments = false;
		}

		// Process URL submissions
		if (pendingUrls.length > 0) {
			for (const { url, title } of pendingUrls) {
				try {
					const res = await fetch('/api/user-resources', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ url, title })
					});

					if (!res.ok) {
						const data = await res.json();
						throw new Error(data.error || `Failed to add ${url}`);
					}

					parts.push(
						`🌐 **Added webpage: [${title}](${url})**\n\n` +
							`Please scrape this URL and extract any relevant professional information from it.`
					);
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to add URL';
					parts.push(`⚠️ Failed to add "${url}": ${msg}`);
				}
			}

			// Invalidate profile so the Links tab updates
			await invalidate('db:profile');
		}

		return parts.join('\n\n---\n\n');
	}

	async function handleSubmit() {
		if (!canSend) return;

		const userText = inputValue.trim();
		inputValue = '';
		resetTextareaHeight();
		attachmentError = '';

		let messageText = userText;

		// Process any pending attachments
		if (hasPendingAttachments) {
			const attachmentText = await processAttachments();

			// Clear pending items
			pendingFiles = [];
			pendingUrls = [];
			showUrlInput = false;

			// Combine user text with attachment context
			if (userText && attachmentText) {
				messageText = `${userText}\n\n${attachmentText}`;
			} else if (attachmentText) {
				messageText = attachmentText;
			}
		}

		if (!messageText) return;

		await chat.sendMessage({ text: messageText });
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function autoResize() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 200) + 'px';
	}

	function resetTextareaHeight() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
	}

	function getTextFromMessage(message: UIMessage): string {
		if (!message.parts) return '';
		return message.parts
			.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
			.map((p) => p.text)
			.join('');
	}

	/**
	 * Extract tool invocation parts from a message using the AI SDK v6 API.
	 */
	function getToolPartsFromMessage(message: UIMessage): DynamicToolUIPart[] {
		if (!message.parts) return [];
		return message.parts.filter((p): p is DynamicToolUIPart =>
			isToolUIPart(p)
		) as DynamicToolUIPart[];
	}

	function formatToolName(name?: string): string {
		if (!name) return 'Tool';
		return name
			.replace(/([A-Z])/g, ' $1')
			.replace(/-/g, ' ')
			.replace(/^\w/, (c) => c.toUpperCase())
			.trim();
	}

	function handleStop() {
		chat.stop();
	}

	function handleClearError() {
		chat.clearError();
	}

	function isOutputAvailable(
		part: DynamicToolUIPart
	): part is DynamicToolUIPart & { state: 'output-available'; output: unknown } {
		return part.state === 'output-available';
	}

	function isErrorState(
		part: DynamicToolUIPart
	): part is DynamicToolUIPart & { state: 'output-error'; errorText: string } {
		return part.state === 'output-error';
	}

	function isInProgress(part: DynamicToolUIPart): boolean {
		return (
			part.state === 'input-streaming' ||
			part.state === 'input-available' ||
			part.state === 'approval-requested' ||
			part.state === 'approval-responded'
		);
	}
</script>

<div class="flex h-150 flex-col overflow-hidden rounded-lg border border-surface-200-800">
	<!-- Chat messages area -->
	<div class="flex-1 space-y-4 overflow-y-auto p-4">
		{#if messages.length === 0 && !isLoading}
			<!-- Empty state -->
			<div class="flex h-full flex-col items-center justify-center text-center">
				<div class="flex size-16 items-center justify-center rounded-full bg-primary-500/10">
					<BotIcon class="size-8 text-primary-500" />
				</div>
				<h3 class="mt-4 text-lg font-semibold">Profile Builder</h3>
				<p class="mt-2 max-w-sm text-sm opacity-60">
					I'll help you build a comprehensive professional profile. Let's start by understanding
					what kind of jobs you're looking for!
				</p>
				<p class="mt-2 max-w-sm text-xs opacity-40">
					You can attach resumes, cover letters, or other documents using the
					<PaperclipIcon class="inline size-3" /> button, or add webpages with the
					<GlobeIcon class="inline size-3" /> button.
				</p>
				<button
					type="button"
					class="mt-4 btn preset-filled-primary-500"
					onclick={() => {
						inputValue = "Hi, I'd like to build my profile!";
						handleSubmit();
					}}
				>
					Get Started
				</button>
			</div>
		{:else}
			{#each messages as message (message.id)}
				{@const isUser = message.role === 'user'}
				{@const text = getTextFromMessage(message)}
				{@const toolParts = getToolPartsFromMessage(message)}

				<div class="flex gap-3 {isUser ? 'flex-row-reverse' : 'flex-row'}">
					<!-- Avatar -->
					<div
						class="flex size-8 shrink-0 items-center justify-center rounded-full {isUser
							? 'bg-primary-500/20'
							: 'bg-surface-200-800'}"
					>
						{#if isUser}
							<UserIcon class="size-4 text-primary-500" />
						{:else}
							<BotIcon class="size-4 opacity-70" />
						{/if}
					</div>

					<!-- Message bubble -->
					<div class="max-w-[80%] space-y-2">
						{#if text}
							<div
								class="rounded-xl px-4 py-2.5 text-sm leading-relaxed {isUser
									? 'bg-primary-500 text-white'
									: 'bg-surface-100-900'}"
							>
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html formatMessageText(text)}
							</div>
						{/if}

						<!-- Tool invocations -->
						{#each toolParts as part (part.toolCallId)}
							<div
								class="flex items-center gap-2 rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-2 text-xs"
							>
								{#if isInProgress(part)}
									<LoaderIcon class="size-3.5 animate-spin text-warning-500" />
									<span class="opacity-70">
										Running {formatToolName(part.toolName)}…
									</span>
								{:else if isOutputAvailable(part)}
									{@const output = part.output as Record<string, unknown> | undefined}
									{#if output && output.success === true}
										<CheckCircleIcon class="size-3.5 text-success-500" />
									{:else if output && output.success === false}
										<AlertCircleIcon class="size-3.5 text-error-500" />
									{:else}
										<WrenchIcon class="size-3.5 text-primary-500" />
									{/if}
									<span class="opacity-70">
										{formatToolName(part.toolName)}
									</span>
									{#if output && typeof output.message === 'string'}
										<span class="ml-1 truncate opacity-50" title={output.message as string}>
											— {output.message}
										</span>
									{/if}
								{:else if isErrorState(part)}
									<AlertCircleIcon class="size-3.5 text-error-500" />
									<span class="opacity-70">
										{formatToolName(part.toolName)} failed
									</span>
									<span class="ml-1 truncate opacity-50" title={part.errorText}>
										— {part.errorText}
									</span>
								{:else}
									<WrenchIcon class="size-3.5 opacity-50" />
									<span class="opacity-50">
										{formatToolName(part.toolName)}
									</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}

			<!-- Streaming indicator -->
			{#if status === 'submitted'}
				<div class="flex gap-3">
					<div
						class="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-200-800"
					>
						<BotIcon class="size-4 opacity-70" />
					</div>
					<div class="flex items-center gap-2 rounded-xl bg-surface-100-900 px-4 py-2.5">
						<LoaderIcon class="size-4 animate-spin opacity-50" />
						<span class="text-sm opacity-50">Thinking…</span>
					</div>
				</div>
			{/if}
		{/if}

		<!-- Scroll anchor -->
		<div bind:this={messagesEndEl}></div>
	</div>

	<!-- Error banner -->
	{#if error}
		<div
			class="flex items-center gap-2 border-t border-error-500/20 bg-error-500/10 px-4 py-2 text-sm text-error-500"
		>
			<AlertCircleIcon class="size-4 shrink-0" />
			<span class="flex-1 truncate">{error.message || 'An error occurred'}</span>
			<button type="button" class="btn preset-tonal btn-sm" onclick={handleClearError}>
				<RotateCcwIcon class="size-3" />
				Retry
			</button>
		</div>
	{/if}

	<!-- URL input popover -->
	{#if showUrlInput}
		<div
			class="flex items-center gap-2 border-t border-surface-200-800 bg-surface-50-950 px-3 py-2"
		>
			<GlobeIcon class="size-4 shrink-0 text-primary-500" />
			<input
				type="url"
				class="input flex-1 py-1.5 text-sm"
				placeholder="https://github.com/username or any URL..."
				bind:value={urlInputValue}
				onkeydown={handleUrlKeydown}
			/>
			<button
				type="button"
				class="btn preset-filled-primary-500 btn-sm"
				disabled={!urlInputValue.trim()}
				onclick={addPendingUrl}
			>
				Add
			</button>
			<button
				type="button"
				class="btn-icon btn-icon-sm preset-tonal"
				onclick={() => {
					showUrlInput = false;
					urlInputValue = '';
				}}
			>
				<XIcon class="size-3.5" />
			</button>
		</div>
	{/if}

	<!-- Attachment error -->
	{#if attachmentError}
		<div
			class="flex items-center gap-2 border-t border-error-500/20 bg-error-500/10 px-3 py-1.5 text-xs text-error-500"
		>
			<AlertCircleIcon class="size-3.5 shrink-0" />
			<span>{attachmentError}</span>
			<button
				type="button"
				class="ml-auto rounded-full p-0.5 hover:bg-error-500/20"
				onclick={() => (attachmentError = '')}
			>
				<XIcon class="size-3" />
			</button>
		</div>
	{/if}

	<!-- Input area -->
	<div class="border-t border-surface-200-800 bg-surface-50-950 p-3">
		<!-- Hidden file input -->
		<input
			bind:this={fileInputEl}
			type="file"
			class="hidden"
			multiple
			accept=".txt,.md,.html,.htm,.json,.csv,.tex,.pdf,.doc,.docx,.rtf"
			onchange={handleFileInputChange}
		/>

		<!-- Row 1: Attachment chips + textarea -->
		<div class="relative">
			{#if hasPendingAttachments}
				<div
					class="pointer-events-none absolute top-0 left-0 z-10 flex max-w-full items-start gap-1 p-2"
				>
					{#each pendingFiles as file, i (file.name + file.size)}
						<div
							class="pointer-events-auto flex max-w-[30%] items-center gap-1 rounded-md border border-surface-200-800 bg-surface-100-900 px-1.5 py-0.5 text-[11px] shadow-sm"
						>
							<FileIcon class="size-3 shrink-0 text-primary-500" />
							<span class="truncate font-medium">{file.name}</span>
							<button
								type="button"
								class="shrink-0 rounded-full p-0.5 transition-colors hover:bg-error-500/20 hover:text-error-500"
								onclick={() => removePendingFile(i)}
								title="Remove file"
							>
								<XIcon class="size-2.5" />
							</button>
						</div>
					{/each}

					{#each pendingUrls as urlItem, i (urlItem.url)}
						<div
							class="pointer-events-auto flex max-w-[30%] items-center gap-1 rounded-md border border-surface-200-800 bg-surface-100-900 px-1.5 py-0.5 text-[11px] shadow-sm"
						>
							<LinkIcon class="size-3 shrink-0 text-primary-500" />
							<span class="truncate font-medium">{urlItem.title}</span>
							<button
								type="button"
								class="shrink-0 rounded-full p-0.5 transition-colors hover:bg-error-500/20 hover:text-error-500"
								onclick={() => removePendingUrl(i)}
								title="Remove URL"
							>
								<XIcon class="size-2.5" />
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<textarea
				bind:this={textareaEl}
				bind:value={inputValue}
				onkeydown={handleKeydown}
				oninput={autoResize}
				placeholder={isUploadingAttachments
					? 'Uploading attachments…'
					: isLoading
						? 'Waiting for response…'
						: 'Type a message… (Shift+Enter for new line)'}
				disabled={isLoading || isUploadingAttachments}
				rows="1"
				class="textarea min-h-10 w-full resize-none text-sm {hasPendingAttachments
					? 'pt-8'
					: 'pt-2.5'} pb-2.5"
			></textarea>
		</div>

		<!-- Row 2: Attachment icons (left) + send (right) -->
		<div class="mt-1.5 flex items-center justify-between">
			<div class="flex items-center gap-1">
				<button
					type="button"
					class="btn-icon btn preset-tonal btn-sm"
					onclick={handleFileSelect}
					disabled={isLoading || isUploadingAttachments}
					title="Attach file (resume, cover letter, etc.)"
				>
					<PaperclipIcon class="size-4" />
				</button>
				<button
					type="button"
					class="btn-icon btn preset-tonal btn-sm {showUrlInput ? 'preset-filled-primary-500' : ''}"
					onclick={toggleUrlInput}
					disabled={isLoading || isUploadingAttachments}
					title="Add webpage URL"
				>
					<GlobeIcon class="size-4" />
				</button>
			</div>

			<div>
				{#if isLoading}
					<button
						type="button"
						class="btn-icon btn shrink-0 preset-tonal"
						onclick={handleStop}
						title="Stop generating"
					>
						<StopCircleIcon class="size-5" />
					</button>
				{:else}
					<button
						type="button"
						class="btn-icon btn shrink-0 preset-filled-primary-500"
						onclick={handleSubmit}
						disabled={!canSend}
						title="Send message"
					>
						{#if isUploadingAttachments}
							<LoaderIcon class="size-5 animate-spin" />
						{:else}
							<SendIcon class="size-5" />
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
