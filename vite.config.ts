import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	define: {
		// Carta: skip bundling Shiki on the server (syntax highlighting is client-only)
		__ENABLE_CARTA_SSR_HIGHLIGHTER__: false
	}
});
