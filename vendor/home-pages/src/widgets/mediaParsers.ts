// SPDX-License-Identifier: GPL-3.0-only
// Public-source parsers extracted from the Home Pages media widget.

export interface MediaItem {
  id: string;
  sourceKey: "qiushi" | "zjxc" | "custom";
  sourceName: string;
  category?: string;
  title: string;
  author?: string;
  column?: string;
  issue?: string;
  date?: string;
  timestamp: number;
  url: string;
  summary?: string;
  fullHtml?: string;
  thumbnail?: string;
  mediaType?: "article" | "audio" | "video";
}

// ---- 求是杂志解析 ------------------------------------------------------------

export interface QiushiIssueRef {
  title: string;
  url: string;
  issueNumber: number;
}

/** 解析求是年度目录页中的所有期号链接 */
export function parseQiushiCatalog(html: string, baseUrl = "https://www.qstheory.cn"): QiushiIssueRef[] {
  const issues: QiushiIssueRef[] = [];
  const regex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    let url = match[1].trim();
    if (!url) continue;
    if (url.startsWith("//")) url = "https:" + url;
    else if (url.startsWith("/")) url = baseUrl + url;

    const rawText = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const issueMatch = rawText.match(/《?求是》?\s*(\d{4}年第(\d+)期)/);
    if (issueMatch) {
      issues.push({
        title: `《求是》${issueMatch[1]}`,
        url,
        issueNumber: parseInt(issueMatch[2], 10)
      });
    }
  }

  issues.sort((a, b) => b.issueNumber - a.issueNumber);
  return issues;
}

/** 解析求是单期页面中的文章列表 */
export function parseQiushiIssueArticles(html: string, issueTitle = "求是杂志", baseUrl = "https://www.qstheory.cn"): MediaItem[] {
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const articles: MediaItem[] = [];
  let pMatch: RegExpExecArray | null;
  let index = 0;

  while ((pMatch = pRegex.exec(html)) !== null) {
    const pContent = pMatch[1];
    const linkMatch = pContent.match(/<a[^>]+href="([^"]*\/c\.html)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    let url = linkMatch[1].trim();
    if (url.startsWith("//")) url = "https:" + url;
    else if (url.startsWith("/")) url = baseUrl + url;
    const rawTitle = linkMatch[2];

    // 提取专栏（如深度调研、求是专访、文化中国、学习问答、党员来信等）
    let column = "";
    const spanColMatch = rawTitle.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
    if (spanColMatch) {
      const candidate = spanColMatch[1].replace(/<[^>]+>/g, "").replace(/[/／\s]/g, "").trim();
      if (candidate.length >= 2 && candidate.length <= 10) column = candidate;
    }
    if (!column) {
      const parenColMatch = pContent.match(/（(党员来信|党刊精选|干部谈体会|思想纵横|思想理论)）/i);
      if (parenColMatch) column = parenColMatch[1];
    }

    // 提取作者：先剥离链接以避免匹配 href 中的斜杠
    const afterLinks = pContent.replace(/<a[\s\S]*?<\/a>/gi, "");
    let author = "";
    const authorMatch = afterLinks.match(/[/／]\s*([^<>\n\r]+)/);
    if (authorMatch) {
      author = authorMatch[1].replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").trim();
      if (author.length > 40) author = author.slice(0, 40) + "…";
    }

    // 清理主标题
    let title = rawTitle.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
    if (column) {
      title = title.replace(new RegExp(`^${column}\\s*[/／]?\\s*`, "i"), "");
    }
    title = title.replace(/^(深度调研|求是专访|文化中国|学习问答|统计图表)\s*[/／]\s*/, "").trim();

    if (!title || title === "扫描二维码分享到手机" || title === "【网站声明】") continue;

    // 解析日期，例如 URL 中 /20260915/...
    const dateMatch = url.match(/\/(\d{4})(\d{2})(\d{2})\//);
    const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : "";
    const timestamp = dateMatch ? new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`).getTime() : Date.now() - index * 60000;

    index += 1;
    articles.push({
      id: `qiushi:${url}`,
      sourceKey: "qiushi",
      sourceName: "求是杂志",
      title,
      author: author || undefined,
      column: column || undefined,
      issue: issueTitle,
      date,
      timestamp,
      url
    });
  }

  return articles;
}

// ---- 浙江宣传解析 ------------------------------------------------------------

/** 解析浙江宣传专栏文章列表 */
export function parseZjxcArticles(html: string, baseUrl = "https://zjnews.zjol.com.cn"): MediaItem[] {
  const items: MediaItem[] = [];
  const regex = /<li class="listLi">[\s\S]*?<span class="listSpan">([\s\S]*?)<\/span>[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(html)) !== null) {
    const rawDate = match[1].replace(/\s+/g, " ").trim();
    let url = match[2].trim();
    if (url.startsWith("//")) url = "https:" + url;
    else if (url.startsWith("/")) url = baseUrl + url;

    let title = match[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    title = title.replace(/^浙江宣传\s*[|｜]\s*/, "").trim();
    if (!title) continue;

    // 解析日期如 "2026年09月14日11时" -> timestamp
    let timestamp = Date.now() - index * 60000;
    const dateMatch = rawDate.match(/(\d{4})年(\d{2})月(\d{2})日(?:(\d{2})时)?/);
    let dateStr = rawDate;
    if (dateMatch) {
      dateStr = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` + (dateMatch[4] ? ` ${dateMatch[4]}:00` : "");
      timestamp = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${dateMatch[4] || "00"}:00:00`).getTime();
    }

    index += 1;
    items.push({
      id: `zjxc:${url}`,
      sourceKey: "zjxc",
      sourceName: "浙江宣传",
      title,
      column: "时评",
      date: dateStr,
      timestamp: Number.isFinite(timestamp) ? timestamp : Date.now() - index * 60000,
      url
    });
  }

  return items;
}
