<script lang="ts">
	import { LoaderCircleIcon, XIcon, ZapIcon, ListPlusIcon } from '@lucide/svelte';

	interface Props {
		/** Company name of the application the user wants to start */
		targetCompany: string;
		/** Job title of the application the user wants to start */
		targetTitle: string;
		/** Company name of the currently running application */
		activeCompany: string;
		/** Job title of the currently running application */
		activeTitle: string;
		/** Called when the user chooses to queue */
		onQueue: () => void;
		/** Called when the user chooses to cancel active and start immediately */
		onCancelAndStart: () => void;
		/** Called when the user dismisses the dialog */
		onClose: () => void;
	}

	let {
		targetCompany,
		targetTitle,
		activeCompany,
		activeTitle,
		onQueue,
		onCancelAndStart,
		onClose
	}: Props = $props();
</script>

<!-- Backdrop -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
	aria-labelledby="conflict-dialog-title"
>
	<div
		class="card w-full max-w-md border border-surface-200-800 bg-surface-50-950 shadow-xl"
		role="document"
	>
		<!-- Header -->
		<div class="flex items-start justify-between border-b border-surface-200-800 p-4">
			<div class="flex items-start gap-3">
				<div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-500/15">
					<LoaderCircleIcon class="size-4 animate-spin text-warning-500" />
				</div>
				<div>
					<h2 id="conflict-dialog-title" class="text-sm font-bold">
						Pipeline Already Running
					</h2>
					<p class="mt-0.5 text-xs opacity-60">Only one application can be processed at a time.</p>
				</div>
			</div>
			<button
				type="button"
				class="btn-icon btn-icon-sm hover:preset-tonal-surface"
				onclick={onClose}
				aria-label="Close"
			>
				<XIcon class="size-4" />
			</button>
		</div>

		<!-- Body -->
		<div class="space-y-3 p-4">
			<!-- Currently running -->
			<div class="rounded-lg border border-warning-500/30 bg-warning-500/5 p-3">
				<p class="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-50">
					Currently processing
				</p>
				<p class="text-sm font-bold">{activeCompany}</p>
				<p class="text-xs opacity-60">{activeTitle}</p>
			</div>

			<div class="flex items-center gap-2 text-xs opacity-40">
				<div class="h-px flex-1 bg-surface-300-700"></div>
				<span>you want to start</span>
				<div class="h-px flex-1 bg-surface-300-700"></div>
			</div>

			<!-- Target application -->
			<div class="rounded-lg border border-primary-500/30 bg-primary-500/5 p-3">
				<p class="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-50">
					Requested
				</p>
				<p class="text-sm font-bold">{targetCompany}</p>
				<p class="text-xs opacity-60">{targetTitle}</p>
			</div>

			<p class="text-xs opacity-60">How would you like to proceed?</p>
		</div>

		<!-- Actions -->
		<div class="flex flex-col gap-2 border-t border-surface-200-800 p-4">
			<!-- Queue option -->
			<button
				type="button"
				class="btn w-full justify-start gap-3 preset-tonal-primary"
				onclick={onQueue}
			>
				<ListPlusIcon class="size-4 shrink-0" />
				<div class="min-w-0 text-left">
					<p class="text-sm font-semibold">Queue it</p>
					<p class="text-xs opacity-60">Wait for the current pipeline to finish, then start.</p>
				</div>
			</button>

			<!-- Cancel & start option -->
			<button
				type="button"
				class="btn w-full justify-start gap-3 preset-tonal-error"
				onclick={onCancelAndStart}
			>
				<ZapIcon class="size-4 shrink-0" />
				<div class="min-w-0 text-left">
					<p class="text-sm font-semibold">Cancel & start now</p>
					<p class="text-xs opacity-60">
						Cancel <span class="font-medium">{activeCompany}</span> and immediately start this one.
					</p>
				</div>
			</button>

			<button
				type="button"
				class="btn w-full preset-ghost-surface btn-sm"
				onclick={onClose}
			>
				Never mind
			</button>
		</div>
	</div>
</div>
