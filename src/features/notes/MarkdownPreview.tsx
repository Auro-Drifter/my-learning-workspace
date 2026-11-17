import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function MarkdownPreview({ text }: { text: string }) {
  return <article className="markdown-preview">
    <Markdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { trust: false, strict: 'warn' }]]}
      urlTransform={(url) => /^https?:\/\//iu.test(url) ? url : ''}
      components={{
        img: ({ alt }) => <span>{alt || '图片'}</span>,
        a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      }}
    >{text}</Markdown>
  </article>;
}
