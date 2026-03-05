<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Xterm, XtermAddon } from '@battlefieldduck/xterm-svelte';
	import type {
		ITerminalOptions,
		ITerminalInitOnlyOptions,
		Terminal
	} from '@battlefieldduck/xterm-svelte';

	interface Props {
		/** SSE source URL to connect to */
		src: string;
		/** Whether to auto-scroll to bottom on new output */
		autoScroll?: boolean;
		/** Reflects whether the SSE stream is open */
		connected?: boolean;
		/** Reflects whether an automatic reconnect is pending */
		reconnecting?: boolean;
	}

	let {
		src,
		autoScroll = $bindable(true),
		connected = $bindable(false),
		reconnecting = $bindable(false)
	}: Props = $props();

	const options: ITerminalOptions & ITerminalInitOnlyOptions = {
		theme: {
			background: '#0d1117',
			foreground: '#e6edf3',
			cursor: '#e6edf3',
			cursorAccent: '#0d1117',
			black: '#484f58',
			red: '#ff7b72',
			green: '#3fb950',
			yellow: '#d29922',
			blue: '#58a6ff',
			magenta: '#bc8cff',
			cyan: '#39c5cf',
			white: '#b1bac4',
			brightBlack: '#6e7681',
			brightRed: '#ffa198',
			brightGreen: '#56d364',
			brightYellow: '#e3b341',
			brightBlue: '#79c0ff',
			brightMagenta: '#d2a8ff',
			brightCyan: '#56d4dd',
			brightWhite: '#f0f6fc'
		},
		fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", ui-monospace, monospace',
		fontSize: 12,
		lineHeight: 1.5,
		scrollback: 5000,
		convertEol: true,
		cursorStyle: 'bar',
		cursorBlink: false,
		disableStdin: true
	};

	let terminal = $state<Terminal>();
	let es: EventSource | null = null;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let retryCount = 0;

	async function onLoad() {
		const FitAddon = new (await XtermAddon.FitAddon()).FitAddon();
		terminal?.loadAddon(FitAddon);
		FitAddon.fit();

		const WebLinksAddon = new (await XtermAddon.WebLinksAddon()).WebLinksAddon();
		terminal?.loadAddon(WebLinksAddon);

		// Fit on container resize
		const el = terminal?.element?.parentElement;
		if (el) {
			new ResizeObserver(() => FitAddon.fit()).observe(el);
		}

		openEventSource(src);
	}

	function openEventSource(url: string) {
		const source = new EventSource(url);
		es = source;

		source.addEventListener('log', (e: MessageEvent) => {
			const line: string = JSON.parse(e.data);
			terminal?.writeln(line);
			if (autoScroll) terminal?.scrollToBottom();
		});

		source.addEventListener('clear', () => {
			terminal?.clear();
		});

		source.onopen = () => {
			connected = true;
			reconnecting = false;
			retryCount = 0;
		};

		source.onerror = () => {
			connected = false;
			source.close();
			es = null;

			const delay = Math.min(1000 * Math.pow(2, retryCount), 16_000);
			retryCount += 1;
			reconnecting = true;
			retryTimer = setTimeout(() => {
				retryTimer = null;
				openEventSource(url);
			}, delay);
		};
	}

	export function connect(url: string = src) {
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
		if (es) {
			es.close();
			es = null;
		}
		connected = false;
		reconnecting = false;
		retryCount = 0;
		terminal?.clear();
		openEventSource(url);
	}

	export function clear() {
		terminal?.clear();
	}

	export function scrollBottom() {
		terminal?.scrollToBottom();
	}

	// Reconnect when src prop changes (source selector switch)
	$effect(() => {
		const url = src;
		if (terminal) connect(url);
	});

	onDestroy(() => {
		if (retryTimer) clearTimeout(retryTimer);
		es?.close();
	});
</script>

<div class="h-full w-full overflow-hidden rounded-xl">
	<Xterm bind:terminal {options} {onLoad} />
</div>
