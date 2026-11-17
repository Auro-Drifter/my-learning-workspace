import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppError } from './filesystem.ts';
import { readResponseBody } from './responseBody.ts';

// Desktop Obsidian exposes requestUrl. The browser edition keeps that bridge scoped to known providers.
const publisherHosts = new Set(['www.qstheory.cn', 'qstheory.cn', 'zjnews.zjol.com.cn']);
const hosts = new Set([
  ...publisherHosts, 'api.open-meteo.com', 'geocoding-api.open-meteo.com',
  'weather.cma.cn', 'github.blog', 'www.nasa.gov',
]);
const maxBytes = 3 * 1024 * 1024;

const windowsPublisherRequest = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Net.HttpWebRequest]::Create([Uri]$env:MLW_PUBLIC_MEDIA_URL)
$request.AllowAutoRedirect = $false
$request.Timeout = 8500
$request.ReadWriteTimeout = 8500
$request.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
$request.Accept = 'text/html,application/xhtml+xml'
$request.Headers['Accept-Language'] = 'zh-CN,zh;q=0.9'
$request.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
$response = $request.GetResponse()
$bytes = New-Object IO.MemoryStream
try {
  $limit = ${maxBytes}
  if ($response.ContentLength -gt $limit) {
    [Console]::Write('{"limited":true}')
    return
  }
  $status = [int]$response.StatusCode
  if ($status -ge 200 -and $status -lt 300) {
    $stream = $response.GetResponseStream()
    $buffer = New-Object byte[] 16384
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      if ($bytes.Length + $read -gt $limit) {
        [Console]::Write('{"limited":true}')
        return
      }
      $bytes.Write($buffer, 0, $read)
    }
  }
  $result = @{
    status = $status
    type = $response.ContentType
    location = $response.Headers['Location']
    body = [Convert]::ToBase64String($bytes.ToArray())
  }
  [Console]::Write(($result | ConvertTo-Json -Compress))
} finally {
  $bytes.Dispose()
  $response.Dispose()
}
`;

async function requestSource(url: URL, signal: AbortSignal) {
  if (process.platform === 'win32' && process.env.SystemRoot && publisherHosts.has(url.hostname)) {
    // Windows networking can reach these publishers when Node's direct TLS connection is reset.
    // Pass the validated URL as data; the shared redirect loop still checks every destination.
    const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const { stdout } = await promisify(execFile)(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsPublisherRequest, 'utf16le').toString('base64'),
    ], {
      env: { ...process.env, MLW_PUBLIC_MEDIA_URL: url.href },
      signal, windowsHide: true, maxBuffer: Math.ceil(maxBytes / 3) * 4 + 4096,
    });
    const result = JSON.parse(stdout) as { limited?: boolean; status: number; body: string; type?: string; location?: string };
    if (result.limited) throw new AppError(413, 'source_too_large', '资讯内容超过网页端的读取上限。');
    const headers = new Headers();
    if (result.type) headers.set('content-type', result.type);
    if (result.location) headers.set('location', result.location);
    const body = result.status === 200 ? new Uint8Array(Buffer.from(result.body, 'base64')) : null;
    return new Response(body, { status: result.status, headers });
  }

  return fetch(url, {
    signal, redirect: 'manual', credentials: 'omit',
    headers: { Accept: 'text/html,application/xml,application/rss+xml,application/json', 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
}

function publicSource(address: string, base?: URL) {
  let url: URL;
  try { url = new URL(address, base); }
  catch { throw new AppError(400, 'invalid_source', '资讯地址无效。'); }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password) {
    throw new AppError(400, 'source_not_supported', '这个频道目前超出网页端支持的来源范围。');
  }
  return url;
}

export async function readHomePagesSource(address: string) {
  let url = publicSource(address);
  const signal = AbortSignal.timeout(9000);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await requestSource(url, signal);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location) break;
        url = publicSource(location, url);
        continue;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        break;
      }
      const bytes = await readResponseBody(response.body, maxBytes, () =>
        new AppError(413, 'source_too_large', '资讯内容超过网页端的读取上限。'));
      const encoding = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([a-zA-Z0-9_-]+)/u)?.[1] ?? 'utf-8';
      const text = new TextDecoder(['gbk', 'gb2312', 'gb18030'].includes(encoding.toLowerCase()) ? 'gb18030' : 'utf-8')
        .decode(bytes);
      return { text, status: response.status };
    }
  } catch (failure) {
    if (failure instanceof AppError) throw failure;
  }
  throw new AppError(502, 'source_unavailable', '资讯来源暂时无法访问，请稍后刷新。');
}
