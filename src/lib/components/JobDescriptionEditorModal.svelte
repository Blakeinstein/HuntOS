<!--
  JobDescriptionEditorModal.svelte
  Thin wrapper around MarkdownEditorModal pre-configured for job descriptions.
-->
<script lang="ts">
	import { FileTextIcon } from '@lucide/svelte';
	import MarkdownEditorModal from '$lib/components/MarkdownEditorModal.svelte';

	interface Props {
		value: string;
		onClose: () => void;
	}

	let { value = $bindable(''), onClose }: Props = $props();
</script>

<MarkdownEditorModal
	bind:value
	title="Job Description"
	icon={FileTextIcon}
	placeholder="Paste the full job description here…

We are looking for a Senior Software Engineer with 5+ years of TypeScript, React, and Node.js experience…"
	{onClose}
/>
