<script lang="ts">
	import { LightboxGallery, GalleryImage, GalleryThumbnail } from 'svelte-lightbox';
	import { ImagesIcon } from '@lucide/svelte';

	interface GalleryImageItem {
		filename: string;
		url: string;
	}

	interface Props {
		name: string;
		images: GalleryImageItem[];
	}

	let { name, images }: Props = $props();

	/** Strip the run-id suffix from folder names like "OpenAI-67" → "OpenAI" */
	function formatFolderName(raw: string): string {
		return raw
			.replace(/-\d+$/, '') // remove trailing -<digits>
			.replace(/_/g, ' ') // underscores → spaces
			.trim();
	}

	/** Extract the run number from folder names like "OpenAI-67" → "Run #67" */
	function extractRunId(raw: string): string | null {
		const match = raw.match(/-(\d+)$/);
		return match ? `Run #${match[1]}` : null;
	}

	/** Humanise a screenshot filename for use as a caption */
	function formatCaption(filename: string): string {
		return filename
			.replace(/\.png$|\.jpg$|\.jpeg$|\.webp$/i, '')
			.replace(/-/g, ' ')
			.replace(/_/g, ' ')
			.replace(/\b\w/g, (c) => c.toUpperCase());
	}

	const title = $derived(formatFolderName(name));
	const runId = $derived(extractRunId(name));
</script>

<div class="space-y-3">
	<!-- Gallery header -->
	<div class="flex items-center gap-2">
		<ImagesIcon class="size-4 shrink-0 text-primary-500" />
		<h3 class="truncate text-sm font-bold">{title}</h3>
		{#if runId}
			<span class="badge shrink-0 preset-tonal text-[10px]">{runId}</span>
		{/if}
		<span class="ml-auto shrink-0 text-xs opacity-40"
			>{images.length} image{images.length !== 1 ? 's' : ''}</span
		>
	</div>

	<!-- svelte-lightbox gallery -->
	<LightboxGallery
		arrowsConfig={{ character: 'loop', enableKeyboardControl: true, color: 'white' }}
		enableClickToClose={true}
		transitionDuration={200}
	>
		<!-- Thumbnail grid -->
		<svelte:fragment slot="thumbnail">
			<div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
				{#each images as image, i (image.url)}
					<GalleryThumbnail id={i}>
						<div
							class="group relative aspect-video cursor-pointer overflow-hidden rounded-lg border border-surface-200-800 bg-surface-100-900 transition-all hover:border-primary-500/50 hover:shadow-md hover:shadow-primary-500/10"
						>
							<img
								src={image.url}
								alt={formatCaption(image.filename)}
								class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
								loading="lazy"
							/>
							<!-- Hover overlay -->
							<div
								class="absolute inset-0 flex items-end bg-linear-to-t from-black/60 via-transparent to-transparent p-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
							>
								<span class="truncate text-[9px] leading-tight font-medium text-white/80">
									{formatCaption(image.filename)}
								</span>
							</div>
						</div>
					</GalleryThumbnail>
				{/each}
			</div>
		</svelte:fragment>

		<!-- Full-size images -->
		{#each images as image, i (image.url)}
			<GalleryImage title={formatCaption(image.filename)} description={name}>
				<img
					src={image.url}
					alt={formatCaption(image.filename)}
					class="max-h-[85vh] max-w-full rounded object-contain"
				/>
			</GalleryImage>
		{/each}
	</LightboxGallery>
</div>
