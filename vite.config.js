import adapter from '@sveltejs/adapter-node';
import vercelAdapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: process.env.VERCEL ? vercelAdapter() : adapter(),
			csp: { mode: 'auto', directives: { 'default-src':['self'], 'script-src':['self'], 'style-src':['self','unsafe-inline'], 'img-src':['self','blob:'], 'connect-src':['self'], 'object-src':['none'], 'base-uri':['self'], 'frame-ancestors':['none'], 'form-action':['self'] } },
			paths: {
				origin: process.env.ORIGIN || (command === 'build' && !process.env.VERCEL ? 'http://localhost:3000' : undefined)
			}
		})
	]
}));
