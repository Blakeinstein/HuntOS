<script lang="ts" module>
	export interface DocumentItem {
		id: number;
		filename: string;
		mime_type: string;
		content_type: string;
		size_bytes: number;
		chunk_count: number;
		created_at: string;
	}
</script>

<script lang="ts">
	import { invalidate } from '$app/navigation';
	import {
		UploadIcon,
		FileTextIcon,
		Trash2Icon,
		LoaderIcon,
		AlertCircleIcon,
		CheckCircleIcon,
		FileIcon,
		FileCodeIcon,
		FileTypeIcon,
		XIcon
	} from '@lucide/svelte';

	interface Props {
		documents: DocumentItem[];
	}

	let { documents }: Props = $props();

	let isUploading = $state(false);
	let uploadError = $state('');
	let uploadSuccess = $state('');
	let deletingId = $state<number | null>(null);
	let dragOver = $state(false);

	// Paste-as-text state
	let showPasteDialog = $state(false);
	let pasteFilename = $state('');
	let pasteContent = $state('');
	let pasteContentType = $state('text/plain');

	const totalSize = $derived(documents.reduce((sum, d) => sum + d.size_bytes, 0));
	const totalChunks = $derived(documents.reduce((sum, d) => sum + d.chunk_count, 0));

	function formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(1024));
		return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function formatDate(dateStr: string): string {
		const d = new Date(dateStr);
		return d.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function getFileIcon(contentType: string): typeof FileTextIcon {
		switch (contentType) {
			case 'markdown':
				return FileCodeIcon;
			case 'html':
				return FileCodeIcon;
			case 'pdf':
				return FileTypeIcon;
			default:
				return FileTextIcon;
		}
	}

	function clearMessages() {
		uploadError = '';
		uploadSuccess = '';
	}

	async function handleFileUpload(files: FileList | null) {
		if (!files || files.length === 0) return;

		clearMessages();
		isUploading = true;

		try {
			for (const file of files) {
				const formData = new FormData();
				formData.append('file', file);

				const res = await fetch('/api/documents', {
					method: 'POST',
					body: formData
				});

				if (!res.ok) {
					const data = await res.json();
					throw new Error(data.error || `Failed to upload ${file.name}`);
				}
			}

			uploadSuccess =
				files.length === 1
					? `Uploaded "${files[0]!.name}" successfully.`
					: `Uploaded ${files.length} files successfully.`;

			await invalidate('db:documents');
			setTimeout(() => (uploadSuccess = ''), 5000);
		} catch (error) {
			uploadError = error instanceof Error ? error.message : 'Upload failed';
		} finally {
			isUploading = false;
		}
	}

	async function handlePasteSubmit() {
		if (!pasteFilename.trim() || !pasteContent.trim()) return;

		clearMessages();
		isUploading = true;

		try {
			const res = await fetch('/api/documents', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					filename: pasteFilename.trim(),
					rawText: pasteContent,
					mimeType: pasteContentType
				})
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Failed to save document');
			}

			uploadSuccess = `Saved "${pasteFilename.trim()}" successfully.`;
			showPasteDialog = false;
			pasteFilename = '';
			pasteContent = '';
			pasteContentType = 'text/plain';

			await invalidate('db:documents');
			setTimeout(() => (uploadSuccess = ''), 5000);
		} catch (error) {
			uploadError = error instanceof Error ? error.message : 'Failed to save document';
		} finally {
			isUploading = false;
		}
	}

	async function handleDelete(id: number, filename: string) {
		if (!confirm(`Delete "${filename}"? This will remove all chunks and embeddings.`)) return;

		clearMessages();
		deletingId = id;

		try {
			const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error || 'Failed to delete document');
			}

			uploadSuccess = `Deleted "${filename}".`;
			await invalidate('db:documents');
			setTimeout(() => (uploadSuccess = ''), 5000);
		} catch (error) {
			uploadError = error instanceof Error ? error.message : 'Delete failed';
		} finally {
			deletingId = null;
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		handleFileUpload(e.dataTransfer?.files ?? null);
	}

	function handleFileInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		handleFileUpload(input.files);
		input.value = '';
	}
</script>

<div class="space-y-4">
	<!-- Stats bar -->
	{#if documents.length > 0}
		<div
			class="flex items-center gap-6 rounded-lg border border-surface-200-800 bg-surface-50-950 px-4 py-3 text-xs"
		>
			<div>
				<span class="font-medium opacity-60">Documents</span>
				<span class="ml-1.5 font-bold">{documents.length}</span>
			</div>
			<div>
				<span class="font-medium opacity-60">Chunks</span>
				<span class="ml-1.5 font-bold">{totalChunks}</span>
			</div>
			<div>
				<span class="font-medium opacity-60">Total Size</span>
				<span class="ml-1.5 font-bold">{formatBytes(totalSize)}</span>
			</div>
		</div>
	{/if}

	<!-- Upload area -->
	<div
		class="relative rounded-lg border-2 border-dashed transition-colors {dragOver
			? 'border-primary-500 bg-primary-500/5'
			: 'border-surface-300-700'}"
		role="region"
		aria-label="Document upload"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
	>
		<div class="flex flex-col items-center gap-3 p-8 text-center">
			{#if isUploading}
				<LoaderIcon class="size-8 animate-spin text-primary-500" />
				<p class="text-sm font-medium">Uploading & processing…</p>
				<p class="text-xs opacity-50">
					Chunking, embedding, and indexing for semantic search.
				</p>
			{:else}
				<UploadIcon class="size-8 opacity-40" />
				<div>
					<p class="text-sm font-medium">Drag & drop files here</p>
					<p class="mt-0.5 text-xs opacity-50">
						Resumes, cover letters, certificates, transcripts, or any other text documents.
					</p>
				</div>
				<div class="flex items-center gap-3">
					<label class="btn preset-filled-primary-500 cursor-pointer text-sm">
						<FileIcon class="mr-1.5 size-4" />
						Choose Files
						<input
							type="file"
							class="hidden"
							multiple
							accept=".txt,.md,.html,.htm,.json,.csv,.tex,.pdf"
							onchange={handleFileInputChange}
						/>
					</label>
					<button
						type="button"
						class="btn preset-tonal text-sm"
						onclick={() => (showPasteDialog = !showPasteDialog)}
					>
						<FileTextIcon class="mr-1.5 size-4" />
						Paste Text
					</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Paste-as-text dialog -->
	{#if showPasteDialog}
		<div class="card space-y-3 border border-surface-200-800 bg-surface-50-950 p-4">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-bold">Paste Document Text</h3>
				<button
					type="button"
					class="btn-icon btn btn-sm preset-tonal"
					onclick={() => (showPasteDialog = false)}
				>
					<XIcon class="size-4" />
				</button>
			</div>

			<div class="grid gap-3 sm:grid-cols-2">
				<label class="label">
					<span class="text-xs font-medium">Filename</span>
					<input
						type="text"
						class="input mt-1"
						placeholder="my-resume.txt"
						bind:value={pasteFilename}
					/>
				</label>
				<label class="label">
					<span class="text-xs font-medium">Format</span>
					<select class="select mt-1" bind:value={pasteContentType}>
						<option value="text/plain">Plain Text</option>
						<option value="text/markdown">Markdown</option>
						<option value="text/html">HTML</option>
					</select>
				</label>
			</div>

			<label class="label">
				<span class="text-xs font-medium">Content</span>
				<textarea
					class="textarea mt-1"
					rows="8"
					placeholder="Paste your document content here…"
					bind:value={pasteContent}
				></textarea>
			</label>

			<div class="flex justify-end">
				<button
					type="button"
					class="btn preset-filled-primary-500 text-sm"
					disabled={!pasteFilename.trim() || !pasteContent.trim() || isUploading}
					onclick={handlePasteSubmit}
				>
					{#if isUploading}
						<LoaderIcon class="mr-1.5 size-4 animate-spin" />
						Processing…
					{:else}
						<UploadIcon class="mr-1.5 size-4" />
						Save & Index
					{/if}
				</button>
			</div>
		</div>
	{/if}

	<!-- Status messages -->
	{#if uploadError}
		<div
			class="flex items-center gap-2 rounded-lg border border-error-500/20 bg-error-500/10 px-4 py-2.5 text-sm text-error-500"
		>
			<AlertCircleIcon class="size-4 shrink-0" />
			<span class="flex-1">{uploadError}</span>
			<button type="button" class="btn-icon btn btn-sm preset-tonal" onclick={clearMessages}>
				<XIcon class="size-3.5" />
			</button>
		</div>
	{/if}

	{#if uploadSuccess}
		<div
			class="flex items-center gap-2 rounded-lg border border-success-500/20 bg-success-500/10 px-4 py-2.5 text-sm text-success-500"
		>
			<CheckCircleIcon class="size-4 shrink-0" />
			<span class="flex-1">{uploadSuccess}</span>
		</div>
	{/if}

	<!-- Document list -->
	{#if documents.length === 0}
		<div class="py-8 text-center">
			<FileTextIcon class="mx-auto size-10 opacity-20" />
			<p class="mt-3 text-sm opacity-50">No documents uploaded yet.</p>
			<p class="mt-1 text-xs opacity-30">
				Upload resumes, cover letters, or other professional documents. They'll be chunked,
				embedded, and available for the AI agent to search for relevant context.
			</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each documents as doc (doc.id)}
				{@const Icon = getFileIcon(doc.content_type)}
				{@const isDeleting = deletingId === doc.id}

				<div
					class="flex items-center gap-3 rounded-lg border border-surface-200-800 bg-surface-50-950 px-4 py-3 transition-opacity {isDeleting
						? 'opacity-50'
						: ''}"
				>
					<!-- Icon -->
					<div
						class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-500/10"
					>
						<Icon class="size-4.5 text-primary-500" />
					</div>

					<!-- Details -->
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{doc.filename}</p>
						<p class="mt-0.5 flex items-center gap-3 text-xs opacity-50">
							<span>{formatBytes(doc.size_bytes)}</span>
							<span>{doc.chunk_count} chunks</span>
							<span>{doc.content_type}</span>
							<span>{formatDate(doc.created_at)}</span>
						</p>
					</div>

					<!-- Delete button -->
					<button
						type="button"
						class="btn-icon btn btn-sm preset-tonal text-error-500 hover:bg-error-500/10"
						disabled={isDeleting}
						title="Delete document"
						onclick={() => handleDelete(doc.id, doc.filename)}
					>
						{#if isDeleting}
							<LoaderIcon class="size-4 animate-spin" />
						{:else}
							<Trash2Icon class="size-4" />
						{/if}
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
