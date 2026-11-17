import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { createApp } from './app.ts';

const host = '127.0.0.1';
const projectDirectory = fileURLToPath(new URL('..', import.meta.url));
const dev = process.argv.includes('--dev');
const port = Number(process.env.MLW_PORT ?? (dev ? '5173' : '4173'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MLW_PORT 必须是有效端口。');
const configuredDirectory = process.env.MLW_DATA_DIR;
if (configuredDirectory && !isAbsolute(configuredDirectory)) throw new Error('MLW_DATA_DIR 必须是绝对路径。');
const dataDirectory = configuredDirectory ?? resolve(projectDirectory, 'data');
const staticDirectory = resolve(projectDirectory, 'dist');

if (!dev) {
  await access(resolve(staticDirectory, 'index.html')).catch(() => {
    throw new Error('缺少构建产物。请先运行 npm run build 或直接运行 npm start。');
  });
}

const origin = 'http://' + host + ':' + port;
const app = createApp({
  dataDirectory,
  staticDirectory: dev ? undefined : staticDirectory,
  devOrigin: dev ? origin : undefined,
  pdfAssetDirectory: resolve(projectDirectory, 'node_modules', 'pdfjs-dist'),
});
const apiAddress = await app.listen({ host, port: dev ? 0 : port });
if (dev) {
  const { createServer } = await import('vite');
  try {
    const vite = await createServer({
      root: projectDirectory,
      server: {
        host, port, strictPort: true,
        proxy: {
          '/api': { target: apiAddress, changeOrigin: true },
          '/plugin-runtime': { target: apiAddress, changeOrigin: true },
          '/pdf-assets': { target: apiAddress, changeOrigin: true },
        },
        fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/server/**', '**/tests/**', dataDirectory.replaceAll('\\', '/') + '/**'] },
      },
    });
    await vite.listen();
  } catch (error) {
    await app.close();
    throw error;
  }
}
console.log('My Learning Workspace · ' + origin);
