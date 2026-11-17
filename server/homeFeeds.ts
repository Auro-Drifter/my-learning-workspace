import { publicHomeFeeds } from '../shared/homeWidgets.ts';
import { AppError } from './filesystem.ts';
import { readResponseBody } from './responseBody.ts';

const maxFeedBytes = 1024 * 1024;

export async function readPublicHomeFeed(id: keyof typeof publicHomeFeeds) {
  const source = publicHomeFeeds[id];
  try {
    const response = await fetch(source.url, {
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(6500),
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !response.body || !/^[^;]*xml\b/iu.test(contentType)) {
      await response.body?.cancel();
      throw new Error('Invalid feed response');
    }
    const bytes = await readResponseBody(response.body, maxFeedBytes, () => new AppError(413, 'feed_too_large', '订阅源超过 1 MiB。'));
    return { xml: bytes.toString('utf8') };
  } catch (failure) {
    if (failure instanceof AppError) throw failure;
    throw new AppError(502, 'feed_unavailable', '暂时无法刷新此公开订阅源。可稍后重试，或导入本地订阅文件。');
  }
}
