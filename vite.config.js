import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { createDemo } from './server/demo.ts';
import { createSamplePdf, sampleNote } from './server/demoFiles.ts';

const fromRoot = (path) => fileURLToPath(new URL(path, import.meta.url));

const demoAssets = {
  name: 'pages-demo-assets',
  async generateBundle() {
    const assets = {
      'demo-workspace.json': JSON.stringify(createDemo()),
      'demo-note.txt': sampleNote,
      'demo-material.pdf': createSamplePdf(),
      'pdf-assets/standard_fonts/LiberationSans-Regular.ttf': await readFile(fromRoot('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf')),
      'pdf-assets/standard_fonts/LICENSE_LIBERATION': await readFile(fromRoot('node_modules/pdfjs-dist/standard_fonts/LICENSE_LIBERATION')),
      '.nojekyll': '',
    };
    for (const [fileName, source] of Object.entries(assets)) this.emitFile({ type: 'asset', fileName, source });
  },
};

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? './' : '/',
  plugins: mode === 'pages' ? [demoAssets] : [],
  resolve: { alias: { obsidian: fromRoot('src/features/home-pages/obsidian.mjs') } },
  build: {
    outDir: mode === 'pages' ? 'dist-pages' : 'dist',
    rollupOptions: { input: { workspace: fromRoot('index.html'), homePages: fromRoot('home-pages.html') } },
  },
}));
