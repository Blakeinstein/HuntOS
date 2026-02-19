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
			.replace(
				/`(.+?)`/g,
				'<code class="rounded bg-surface-200-800 px-1 py-0.5 text-xs">$1</code>'
			)
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
		FileTextIcon,
		CopyIcon
	} from '@lucide/svelte';

	const chat = new Chat({
		id: 'resume-writer',
		transport: new DefaultChatTransport({
			api: '/api/chat/resume'
		}),
		onFinish() {
			invalidate('db:resume-templates');
		},
		onError(error) {
			console.error('Resume chat error:', error);
		}
	});

	let inputValue = $state('');
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let messagesEndEl = $state<HTMLDivElement | null>(null);
	let copiedId = $state<string | null>(null);

	const messages = $derived(chat.messages);
	const status = $derived(chat.status);
	const error = $derived(chat.error);
	const isLoading = $derived(status === 'streaming' || status === 'submitted');

	$effect(() => {
		loadExistingMessages();
	});

	$effect(() => {
		if (messages.length > 0) {
			scrollToBottom();
		}
	});

	async function loadExistingMessages() {
		try {
			const res = await fetch('/api/chat/resume');
			if (res.ok) {
				const existing: UIMessage[] = await res.json();
				if (existing.length > 0) {
					chat.messages = existing;
				}
			}
		} catch (err) {
			console.error('Failed to load existing resume chat messages:', err);
		}
	}

	function scrollToBottom() {
		requestAnimationFrame(() => {
			messagesEndEl?.scrollIntoView({ behavior: 'smooth' });
		});
	}

	async function handleSubmit() {
		const text = inputValue.trim();
		if (!text || isLoading) return;

		inputValue = '';
		resetTextareaHeight();

		await chat.sendMessage({ text });
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

	function getToolPartsFromMessage(message: UIMessage): DynamicToolUIPart[] {
		if (!message.parts) return [];
		return message.parts.filter((p): p is DynamicToolUIPart =>
			isToolUIPart(p)
		) as DynamicToolUIPart[];
	}

	function formatToolName(name: string): string {
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

	/**
	 * Check if a tool output contains generated resume markdown.
	 */
	function getResumeMarkdown(part: DynamicToolUIPart): string | null {
		if (!isOutputAvailable(part)) return null;
		const output = part.output as Record<string, unknown> | undefined;
		if (output && output.success === true && typeof output.markdown === 'string' && output.markdown.length > 0) {
			return output.markdown as string;
		}
		return null;
	}

	async function copyMarkdown(markdown: string, toolCallId: string) {
		try {
			await navigator.clipboard.writeText(markdown);
			copiedId = toolCallId;
			setTimeout(() => {
				if (copiedId === toolCallId) copiedId = null;
			}, 2000);
		} catch {
			// clipboard API not available
		}
	}
</script>

<div class="flex h-150 flex-col overflow-hidden rounded-lg border border-surface-200-800">
	<!-- Chat messages area -->
	<div class="flex-1 space-y-4 overflow-y-auto p-4">
		{#if messages.length === 0 && !isLoading}
			<!-- Empty state -->
			<div class="flex h-full flex-col items-center justify-center text-center">
				<div class="flex size-16 items-center justify-center rounded-full bg-primary-500/10">
					<FileTextIcon class="size-8 text-primary-500" />
				</div>
				<h3 class="mt-4 text-lg font-semibold">Resume Writer</h3>
				<p class="mt-2 max-w-sm text-sm opacity-60">
					I'll help you create a tailored, ATS-friendly resume for any job posting.
					Paste a job description and I'll generate a resume highlighting your most relevant experience.
				</p>
				<button
					type="button"
					class="mt-4 btn preset-filled-primary-500"
					onclick={() => {
						inputValue = "Hi, I'd like to generate a resume for a job I'm applying to.";
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
							{@const resumeMd = getResumeMarkdown(part)}

							{#if resumeMd}
								<!-- Special rendering for generated resumes -->
								<div class="space-y-2 rounded-lg border border-primary-500/20 bg-primary-500/5 p-3">
									<div class="flex items-center justify-between">
										<span class="flex items-center gap-1.5 text-xs font-bold text-primary-500">
											<CheckCircleIcon class="size-3.5" />
											Resume Generated
										</span>
										<button
											type="button"
											class="btn gap-1 preset-tonal btn-sm"
											onclick={() => copyMarkdown(resumeMd, part.toolCallId)}
										>
											{#if copiedId === part.toolCallId}
												<CheckCircleIcon class="size-3" />
												<span class="text-[11px]">Copied!</span>
											{:else}
												<CopyIcon class="size-3" />
												<span class="text-[11px]">Copy</span>
											{/if}
										</button>
									</div>
									<div class="max-h-75 overflow-y-auto rounded border border-surface-200-800 bg-surface-100-900 p-3">
										<pre class="font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{resumeMd}</pre>
									</div>
								</div>
							{:else}
								<!-- Standard tool status display -->
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
							{/if}
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

	<!-- Input area -->
	<div class="border-t border-surface-200-800 bg-surface-50-950 p-3">
		<div class="flex items-end gap-2">
			<textarea
				bind:this={textareaEl}
				bind:value={inputValue}
				onkeydown={handleKeydown}
				oninput={autoResize}
				placeholder={isLoading
					? 'Generating resume…'
					: 'Paste a job description or describe the role… (Shift+Enter for new line)'}
				disabled={isLoading}
				rows="1"
				class="textarea min-h-10 flex-1 resize-none py-2.5 text-sm"
			></textarea>

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
					disabled={!inputValue.trim()}
					title="Send message"
				>
					<SendIcon class="size-5" />
				</button>
			{/if}
		</div>

		<p class="mt-1.5 text-center text-[10px] opacity-40">
			Paste a job description and I'll tailor your resume. Generation may take 1–2 minutes.
		</p>
	</div>
</div>
