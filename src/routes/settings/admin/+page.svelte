<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import LogTerminal from '$lib/components/LogTerminal.svelte';

	function focusAction(node: HTMLElement) {
		node.focus();
	}
	import {
		DatabaseIcon,
		FileTextIcon,
		FolderIcon,
		TrashIcon,
		RefreshCwIcon,
		EyeIcon,
		DownloadIcon,
		ChevronLeftIcon,
		ChevronRightIcon,
		XIcon,
		AlertTriangleIcon,
		CheckIcon,
		Loader2Icon,
		ImageIcon,
		FileIcon,
		ScrollTextIcon
	} from '@lucide/svelte';

	// ── Tab state ─────────────────────────────────────────────────────────────
	type Tab = 'db' | 'logs' | 'files';
	let activeTab = $state<Tab>('db');

	// ─────────────────────────────────────────────────────────────────────────
	// DB TAB
	// ─────────────────────────────────────────────────────────────────────────

	interface ColumnInfo {
		name: string;
		type: string;
	}

	interface TableMeta {
		name: string;
		rowCount: number;
		columns: ColumnInfo[];
	}

	interface TableData {
		table: string;
		columns: ColumnInfo[];
		rows: Record<string, unknown>[];
		total: number;
		limit: number;
		offset: number;
	}

	let tables = $state<TableMeta[]>([]);
	let tablesLoading = $state(false);
	let selectedTable = $state<string | null>(null);
	let tableData = $state<TableData | null>(null);
	let tableLoading = $state(false);
	let tableError = $state<string | null>(null);
	let tablePage = $state(0);
	const TABLE_PAGE_SIZE = 100;

	// Inline editing
	let editingCell = $state<{ rowIdx: number; col: string } | null>(null);
	let editValue = $state('');
	let savingCell = $state(false);

	// Wipe confirmation
	let wipeTarget = $state<string | null>(null);
	let wiping = $state(false);
	let wipeSuccess = $state<string | null>(null);

	async function loadTables() {
		tablesLoading = true;
		try {
			const res = await fetch('/api/admin/db');
			tables = await res.json();
		} finally {
			tablesLoading = false;
		}
	}

	async function selectTable(name: string) {
		selectedTable = name;
		tablePage = 0;
		await loadTableData();
	}

	async function loadTableData() {
		if (!selectedTable) return;
		tableLoading = true;
		tableError = null;
		try {
			const params = new URLSearchParams({
				table: selectedTable,
				limit: String(TABLE_PAGE_SIZE),
				offset: String(tablePage * TABLE_PAGE_SIZE)
			});
			const res = await fetch(`/api/admin/db?${params}`);
			if (!res.ok) {
				const err = await res.json();
				tableError = err.error ?? 'Failed to load table';
				return;
			}
			tableData = await res.json();
		} finally {
			tableLoading = false;
		}
	}

	function startEdit(rowIdx: number, col: string, currentValue: unknown) {
		editingCell = { rowIdx, col };
		editValue = currentValue == null ? '' : String(currentValue);
	}

	function cancelEdit() {
		editingCell = null;
		editValue = '';
	}

	async function saveEdit(row: Record<string, unknown>) {
		if (!editingCell || !selectedTable) return;
		savingCell = true;
		try {
			const rowid = row['id'] ?? row['rowid'];
			const res = await fetch('/api/admin/db', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					table: selectedTable,
					rowid: Number(rowid),
					column: editingCell.col,
					value: editValue === '' ? null : editValue
				})
			});
			if (res.ok) {
				const { updated } = await res.json();
				if (tableData) {
					tableData.rows[editingCell.rowIdx] = updated;
				}
				editingCell = null;
			}
		} finally {
			savingCell = false;
		}
	}

	async function confirmWipe(table: string) {
		wiping = true;
		wipeSuccess = null;
		try {
			const res = await fetch('/api/admin/db', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ table })
			});
			const data = await res.json();
			if (res.ok) {
				wipeSuccess = `Deleted ${data.deleted} rows from "${table}"`;
				wipeTarget = null;
				await loadTables();
				if (selectedTable === table) {
					await loadTableData();
				}
			}
		} finally {
			wiping = false;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// LOGS TAB
	// ─────────────────────────────────────────────────────────────────────────

	type LogSource = 'dev' | 'chrome';

	let logSource = $state<LogSource>('dev');
	let logAutoScroll = $state(true);
	let logTerminal = $state<LogTerminal | null>(null);
	let logConnected = $state(false);
	let logReconnecting = $state(false);

	function logSrc(source: LogSource) {
		return `/api/admin/logs?source=${source}`;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// FILES TAB
	// ─────────────────────────────────────────────────────────────────────────

	type FileBucket = 'resumes' | 'screenshots' | 'user-resources';

	interface BucketSummary {
		bucket: string;
		fileCount: number;
		totalSize: number;
		totalSizeHuman: string;
	}

	interface FileEntry {
		name: string;
		relPath: string;
		bucket: string;
		size: number;
		sizeHuman: string;
		mime: string;
		ext: string;
		modifiedAt: string;
	}

	let buckets = $state<BucketSummary[]>([]);

	let selectedBucket = $state<FileBucket | null>(null);
	let bucketFiles = $state<FileEntry[]>([]);
	let bucketLoading = $state(false);
	let previewFile = $state<FileEntry | null>(null);
	let previewUrl = $state<string | null>(null);
	let previewText = $state<string | null>(null);
	let deletingFile = $state<string | null>(null);
	let deleteFileTarget = $state<FileEntry | null>(null);

	async function loadBuckets() {
		try {
			const res = await fetch('/api/admin/files');
			buckets = await res.json();
		} catch {
			// silently ignore
		}
	}

	async function selectBucket(bucket: FileBucket) {
		selectedBucket = bucket;
		bucketLoading = true;
		previewFile = null;
		previewUrl = null;
		previewText = null;
		try {
			const res = await fetch(`/api/admin/files?bucket=${bucket}`);
			const data = await res.json();
			bucketFiles = data.files ?? [];
		} finally {
			bucketLoading = false;
		}
	}

	async function previewFileEntry(entry: FileEntry) {
		previewFile = entry;
		// Use relPath so nested screenshot paths (e.g. "run-dir/subdir/final.png") resolve correctly
		previewUrl = `/api/admin/files?bucket=${entry.bucket}&file=${encodeURIComponent(entry.relPath)}`;
		previewText = null;

		// For text-like files, fetch as text
		if (['md', 'txt', 'json', 'html'].includes(entry.ext)) {
			try {
				const res = await fetch(previewUrl);
				previewText = await res.text();
			} catch {
				previewText = 'Failed to load text content.';
			}
		}
	}

	async function deleteFile(entry: FileEntry) {
		deletingFile = entry.name;
		try {
			const res = await fetch('/api/admin/files', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bucket: entry.bucket, file: entry.name })
			});
			if (res.ok) {
				bucketFiles = bucketFiles.filter((f) => f.name !== entry.name);
				if (previewFile?.name === entry.name) {
					previewFile = null;
					previewUrl = null;
					previewText = null;
				}
				deleteFileTarget = null;
				await loadBuckets();
			}
		} finally {
			deletingFile = null;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────────

	onMount(async () => {
		await loadTables();
		await loadBuckets();
		// Connect logs when tab is first opened lazily
	});

	onDestroy(() => {
		// LogTerminal handles its own cleanup via onDestroy
	});

	// ─────────────────────────────────────────────────────────────────────────
	// Helpers
	// ─────────────────────────────────────────────────────────────────────────

	function formatCellValue(val: unknown): string {
		if (val == null) return 'NULL';
		if (typeof val === 'object') return JSON.stringify(val);
		return String(val);
	}

	function isLongValue(val: unknown): boolean {
		return typeof val === 'string' && val.length > 60;
	}

	function bucketIcon(bucket: string) {
		if (bucket === 'resumes') return FileTextIcon;
		if (bucket === 'screenshots') return ImageIcon;
		return FolderIcon;
	}

	function fileIcon(ext: string) {
		if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return ImageIcon;
		if (['md', 'txt'].includes(ext)) return FileTextIcon;
		if (ext === 'pdf') return ScrollTextIcon;
		return FileIcon;
	}
</script>

<div class="mx-auto max-w-7xl space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="h3 font-bold">Admin</h1>
			<p class="text-sm opacity-60">Inspect and manage local data, logs, and files.</p>
		</div>
		<div class="flex items-center gap-2">
			<a
				href="http://localhost:3000/"
				target="_blank"
				rel="noopener noreferrer"
				class="btn preset-tonal btn-sm text-xs"
			>
				Open Mastra Studio ↗
			</a>
			<span class="badge preset-filled-error-500 text-xs">Internal Use Only</span>
		</div>
	</div>

	<!-- Tabs -->
	<div class="flex gap-1 border-b border-surface-200-800">
		{#each [{ id: 'db' as Tab, label: 'Database', icon: DatabaseIcon }, { id: 'logs' as Tab, label: 'Server Logs', icon: ScrollTextIcon }, { id: 'files' as Tab, label: 'Data Files', icon: FolderIcon }] as tab (tab.id)}
			{@const Icon = tab.icon}
			<button
				type="button"
				class="flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors
					{activeTab === tab.id
					? 'border-primary-500 text-primary-500'
					: 'border-transparent opacity-60 hover:opacity-100'}"
				onclick={() => (activeTab = tab.id)}
			>
				<Icon class="size-4" />
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- ── DB TAB ──────────────────────────────────────────────────────────── -->
	{#if activeTab === 'db'}
		<div class="grid grid-cols-[220px_1fr] gap-4">
			<!-- Table list sidebar -->
			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<span class="text-xs font-semibold tracking-wider uppercase opacity-50">Tables</span>
					<button
						type="button"
						class="btn-icon size-6 hover:preset-tonal"
						onclick={loadTables}
						aria-label="Refresh tables"
					>
						<RefreshCwIcon class="size-3.5 {tablesLoading ? 'animate-spin' : ''}" />
					</button>
				</div>

				{#if tablesLoading}
					<div class="flex items-center gap-2 py-4 opacity-50">
						<Loader2Icon class="size-4 animate-spin" />
						<span class="text-sm">Loading…</span>
					</div>
				{:else}
					<div class="space-y-0.5">
						{#each tables as table (table.name)}
							<button
								type="button"
								class="group flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors
									{selectedTable === table.name ? 'preset-tonal-primary' : 'hover:bg-surface-200-800'}"
								onclick={() => selectTable(table.name)}
							>
								<span class="truncate font-mono text-xs">{table.name}</span>
								<span class="ml-1 shrink-0 text-[10px] opacity-50">{table.rowCount}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Table data panel -->
			<div class="min-w-0 space-y-3">
				{#if wipeSuccess}
					<div
						class="flex items-center gap-2 rounded-lg border border-success-500/30 bg-success-500/10 px-3 py-2 text-sm text-success-500"
					>
						<CheckIcon class="size-4 shrink-0" />
						{wipeSuccess}
						<button
							type="button"
							class="ml-auto"
							onclick={() => (wipeSuccess = null)}
							aria-label="Dismiss"
						>
							<XIcon class="size-3.5" />
						</button>
					</div>
				{/if}

				{#if !selectedTable}
					<div
						class="flex h-48 items-center justify-center rounded-xl border border-dashed border-surface-300-700 text-sm opacity-40"
					>
						Select a table to inspect
					</div>
				{:else}
					<!-- Table header -->
					<div class="flex items-center justify-between">
						<div>
							<span class="font-mono font-semibold">{selectedTable}</span>
							{#if tableData}
								<span class="ml-2 text-xs opacity-50">{tableData.total} rows total</span>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<button type="button" class="btn preset-tonal btn-sm" onclick={loadTableData}>
								<RefreshCwIcon class="size-3.5 {tableLoading ? 'animate-spin' : ''}" />
								Refresh
							</button>
							<button
								type="button"
								class="btn preset-filled-error-500 btn-sm"
								onclick={() => (wipeTarget = selectedTable)}
							>
								<TrashIcon class="size-3.5" />
								Wipe
							</button>
						</div>
					</div>

					{#if tableLoading}
						<div class="flex items-center gap-2 py-8 opacity-50">
							<Loader2Icon class="size-4 animate-spin" />
							<span class="text-sm">Loading rows…</span>
						</div>
					{:else if tableError}
						<div
							class="rounded-lg border border-error-500/30 bg-error-500/10 px-3 py-2 text-sm text-error-500"
						>
							{tableError}
						</div>
					{:else if tableData}
						<!-- Table grid -->
						<div class="overflow-x-auto rounded-xl border border-surface-200-800">
							<table class="w-full text-left text-xs">
								<thead class="border-b border-surface-200-800 bg-surface-50-950">
									<tr>
										{#each tableData.columns as col (col.name)}
											<th class="px-3 py-2 font-semibold whitespace-nowrap opacity-70">
												{col.name}
												<span class="ml-1 font-normal opacity-40">{col.type}</span>
											</th>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each tableData.rows as row, rowIdx (rowIdx)}
										<tr class="border-b border-surface-100-900 hover:bg-surface-50-950">
											{#each tableData.columns as col (col.name)}
												{@const val = row[col.name]}
												{@const isEditing =
													editingCell?.rowIdx === rowIdx && editingCell?.col === col.name}
												<td class="max-w-50 px-3 py-1.5 align-top">
													{#if isEditing}
														<div class="flex items-center gap-1">
															<input
																class="input-sm input w-full font-mono text-xs"
																bind:value={editValue}
																onkeydown={(e) => {
																	if (e.key === 'Enter') saveEdit(row);
																	if (e.key === 'Escape') cancelEdit();
																}}
																use:focusAction
															/>
															<button
																type="button"
																class="btn-icon size-5 preset-filled-success-500"
																onclick={() => saveEdit(row)}
																aria-label="Save"
															>
																{#if savingCell}
																	<Loader2Icon class="size-3 animate-spin" />
																{:else}
																	<CheckIcon class="size-3" />
																{/if}
															</button>
															<button
																type="button"
																class="btn-icon size-5 preset-tonal"
																onclick={cancelEdit}
																aria-label="Cancel"
															>
																<XIcon class="size-3" />
															</button>
														</div>
													{:else}
														<button
															type="button"
															class="group/cell w-full text-left"
															ondblclick={() => startEdit(rowIdx, col.name, val)}
															title="Double-click to edit"
														>
															{#if val == null}
																<span class="italic opacity-30">NULL</span>
															{:else if isLongValue(val)}
																<span class="line-clamp-2 font-mono opacity-80">
																	{formatCellValue(val)}
																</span>
															{:else}
																<span class="font-mono opacity-80">{formatCellValue(val)}</span>
															{/if}
														</button>
													{/if}
												</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>

						<!-- Pagination -->
						{#if tableData.total > TABLE_PAGE_SIZE}
							<div class="flex items-center justify-between text-xs opacity-60">
								<span>
									Showing {tablePage * TABLE_PAGE_SIZE + 1}–{Math.min(
										(tablePage + 1) * TABLE_PAGE_SIZE,
										tableData.total
									)} of {tableData.total}
								</span>
								<div class="flex gap-1">
									<button
										type="button"
										class="btn-icon size-7 hover:preset-tonal disabled:opacity-30"
										disabled={tablePage === 0}
										onclick={() => {
											tablePage--;
											loadTableData();
										}}
									>
										<ChevronLeftIcon class="size-4" />
									</button>
									<button
										type="button"
										class="btn-icon size-7 hover:preset-tonal disabled:opacity-30"
										disabled={(tablePage + 1) * TABLE_PAGE_SIZE >= tableData.total}
										onclick={() => {
											tablePage++;
											loadTableData();
										}}
									>
										<ChevronRightIcon class="size-4" />
									</button>
								</div>
							</div>
						{/if}
					{/if}
				{/if}
			</div>
		</div>

		<!-- Wipe confirmation modal -->
		{#if wipeTarget}
			<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
				<div class="max-w-sm space-y-4 card border border-error-500/40 bg-surface-50-950 p-6">
					<div class="flex items-center gap-3 text-error-500">
						<AlertTriangleIcon class="size-6 shrink-0" />
						<h2 class="font-bold">Wipe table "{wipeTarget}"?</h2>
					</div>
					<p class="text-sm opacity-70">
						This will permanently delete <strong>all rows</strong> from
						<code class="font-mono">{wipeTarget}</code>. This cannot be undone.
					</p>
					<div class="flex justify-end gap-2">
						<button type="button" class="btn preset-tonal" onclick={() => (wipeTarget = null)}>
							Cancel
						</button>
						<button
							type="button"
							class="btn preset-filled-error-500"
							disabled={wiping}
							onclick={() => wipeTarget && confirmWipe(wipeTarget)}
						>
							{#if wiping}
								<Loader2Icon class="size-4 animate-spin" />
							{:else}
								<TrashIcon class="size-4" />
							{/if}
							Delete All Rows
						</button>
					</div>
				</div>
			</div>
		{/if}
	{/if}

	<!-- ── LOGS TAB ────────────────────────────────────────────────────────── -->
	{#if activeTab === 'logs'}
		<div class="space-y-3">
			<!-- Controls -->
			<div class="flex flex-wrap items-center gap-3">
				<!-- Source selector -->
				<div class="flex gap-1 rounded-lg border border-surface-200-800 p-1">
					{#each [{ id: 'dev' as LogSource, label: 'Dev Server' }, { id: 'chrome' as LogSource, label: 'Chrome' }] as src (src.id)}
						<button
							type="button"
							class="rounded px-3 py-1 text-xs font-medium transition-colors
								{logSource === src.id ? 'preset-filled-primary-500' : 'hover:preset-tonal'}"
							onclick={() => (logSource = src.id)}
						>
							{src.label}
						</button>
					{/each}
				</div>

				<!-- Status indicator -->
				<div class="flex items-center gap-1.5 text-xs">
					<span
						class="size-2 rounded-full {logConnected
							? 'animate-pulse bg-success-500'
							: logReconnecting
								? 'animate-pulse bg-warning-500'
								: 'bg-error-500'}"
					></span>
					<span class="opacity-60">
						{#if logConnected}
							Connected
						{:else if logReconnecting}
							Reconnecting…
						{:else}
							Disconnected
						{/if}
					</span>
				</div>

				<div class="ml-auto flex gap-2">
					<label class="flex cursor-pointer items-center gap-1.5 text-xs opacity-70">
						<input type="checkbox" class="checkbox size-3.5" bind:checked={logAutoScroll} />
						Auto-scroll
					</label>
					{#if !logConnected}
						<button
							type="button"
							class="btn preset-tonal btn-sm"
							onclick={() => logTerminal?.connect()}
						>
							<RefreshCwIcon class="size-3.5 {logReconnecting ? 'animate-spin' : ''}" />
							Reconnect
						</button>
					{/if}
					<button
						type="button"
						class="btn preset-tonal btn-sm"
						onclick={() => logTerminal?.clear()}
					>
						<XIcon class="size-3.5" />
						Clear
					</button>
					<button
						type="button"
						class="btn preset-tonal btn-sm"
						onclick={() => logTerminal?.scrollBottom()}
					>
						<ChevronRightIcon class="size-3.5 rotate-90" />
						Bottom
					</button>
				</div>
			</div>

			<!-- Log output -->
			<div
				class="h-[calc(100vh-280px)] min-h-75 overflow-hidden rounded-xl border border-surface-200-800"
			>
				<LogTerminal
					bind:this={logTerminal}
					src={logSrc(logSource)}
					bind:autoScroll={logAutoScroll}
					bind:connected={logConnected}
					bind:reconnecting={logReconnecting}
				/>
			</div>
		</div>
	{/if}

	<!-- ── FILES TAB ──────────────────────────────────────────────────────── -->
	{#if activeTab === 'files'}
		<div class="space-y-4">
			<!-- Bucket cards -->
			<div class="grid grid-cols-3 gap-3">
				{#each buckets as bucket (bucket.bucket)}
					{@const Icon = bucketIcon(bucket.bucket)}
					<button
						type="button"
						class="flex items-center gap-3 card border p-4 text-left transition-all
							{selectedBucket === bucket.bucket
							? 'border-primary-500 bg-primary-500/5'
							: 'border-surface-200-800 bg-surface-50-950 hover:border-primary-500/40'}"
						onclick={() => selectBucket(bucket.bucket as FileBucket)}
					>
						<div
							class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10"
						>
							<Icon class="size-5 text-primary-500" />
						</div>
						<div class="min-w-0">
							<div class="text-sm font-semibold">{bucket.bucket}</div>
							<div class="text-xs opacity-50">
								{bucket.fileCount} files · {bucket.totalSizeHuman}
							</div>
						</div>
					</button>
				{/each}
			</div>

			{#if selectedBucket}
				<div class="grid grid-cols-[280px_1fr] gap-4">
					<!-- File list -->
					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<span class="text-xs font-semibold tracking-wider uppercase opacity-50">
								{selectedBucket}
							</span>
							<span class="text-xs opacity-40">{bucketFiles.length} files</span>
						</div>

						{#if bucketLoading}
							<div class="flex items-center gap-2 py-4 opacity-50">
								<Loader2Icon class="size-4 animate-spin" />
								<span class="text-sm">Loading…</span>
							</div>
						{:else if bucketFiles.length === 0}
							<div
								class="rounded-xl border border-dashed border-surface-300-700 py-8 text-center text-sm opacity-40"
							>
								No files
							</div>
						{:else}
							<div class="max-h-[calc(100vh-360px)] space-y-0.5 overflow-y-auto">
								{#each bucketFiles as file (file.name)}
									{@const FIcon = fileIcon(file.ext)}
									<!-- Use div+role so we can nest the delete button without invalid HTML -->
									<div
										role="button"
										tabindex="0"
										class="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors
												{previewFile?.name === file.name ? 'preset-tonal-primary' : 'hover:bg-surface-200-800'}"
										onclick={() => previewFileEntry(file)}
										onkeydown={(e) => e.key === 'Enter' && previewFileEntry(file)}
									>
										<FIcon class="size-4 shrink-0 opacity-60" />
										<div class="min-w-0 flex-1">
											<div class="truncate font-mono text-xs">{file.name}</div>
											<div class="text-[10px] opacity-40">{file.sizeHuman}</div>
										</div>
										<button
											type="button"
											class="btn-icon size-5 opacity-0 transition-opacity group-hover:opacity-60 hover:text-error-500"
											onclick={(e) => {
												e.stopPropagation();
												deleteFileTarget = file;
											}}
											aria-label="Delete file"
										>
											<TrashIcon class="size-3" />
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Preview panel -->
					<div class="min-w-0 rounded-xl border border-surface-200-800 bg-surface-50-950">
						{#if !previewFile}
							<div class="flex h-48 items-center justify-center text-sm opacity-40">
								Select a file to preview
							</div>
						{:else}
							<div class="flex h-full flex-col">
								<!-- Preview header -->
								<div
									class="flex items-center justify-between border-b border-surface-200-800 px-4 py-3"
								>
									<div class="min-w-0">
										<div class="truncate font-mono text-sm font-semibold">{previewFile.name}</div>
										<div class="text-xs opacity-50">
											{previewFile.sizeHuman} · {previewFile.mime}
										</div>
									</div>
									<div class="flex items-center gap-2">
										{#if previewUrl}
											<button
												type="button"
												class="btn preset-tonal btn-sm"
												onclick={() => {
													if (!previewUrl || !previewFile) return;
													const a = document.createElement('a');
													a.href = previewUrl;
													a.download = previewFile.name;
													a.click();
												}}
											>
												<DownloadIcon class="size-3.5" />
												Download
											</button>
										{/if}
										<button
											type="button"
											class="btn-icon size-7 hover:text-error-500"
											onclick={() => {
												deleteFileTarget = previewFile;
											}}
											aria-label="Delete"
										>
											<TrashIcon class="size-4" />
										</button>
									</div>
								</div>

								<!-- Preview content -->
								<div class="flex-1 overflow-auto p-4">
									{#if previewFile.mime.startsWith('image/')}
										<img
											src={previewUrl ?? ''}
											alt={previewFile.name}
											class="max-h-[60vh] max-w-full rounded object-contain"
										/>
									{:else if previewFile.mime === 'application/pdf'}
										<iframe
											src={previewUrl ?? ''}
											title={previewFile.name}
											class="h-[60vh] w-full rounded border-0"
										></iframe>
									{:else if previewText !== null}
										<pre
											class="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap opacity-80">{previewText}</pre>
									{:else}
										<div class="flex h-32 items-center justify-center text-sm opacity-40">
											<EyeIcon class="mr-2 size-4" />
											Preview not available — use Download
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Delete file confirmation modal -->
		{#if deleteFileTarget}
			<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
				<div class="max-w-sm space-y-4 card border border-error-500/40 bg-surface-50-950 p-6">
					<div class="flex items-center gap-3 text-error-500">
						<AlertTriangleIcon class="size-6 shrink-0" />
						<h2 class="font-bold">Delete file?</h2>
					</div>
					<p class="text-sm opacity-70">
						Permanently delete
						<code class="font-mono text-xs">{deleteFileTarget.name}</code>? This cannot be undone.
					</p>
					<div class="flex justify-end gap-2">
						<button
							type="button"
							class="btn preset-tonal"
							onclick={() => (deleteFileTarget = null)}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn preset-filled-error-500"
							disabled={deletingFile === deleteFileTarget.name}
							onclick={() => deleteFileTarget && deleteFile(deleteFileTarget)}
						>
							{#if deletingFile === deleteFileTarget.name}
								<Loader2Icon class="size-4 animate-spin" />
							{:else}
								<TrashIcon class="size-4" />
							{/if}
							Delete
						</button>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
