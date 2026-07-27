import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

interface MarkdownProps {
  content: string;
  className?: string;
}

// Configure marked for GitHub Flavored Markdown (tables, lists, code blocks)
marked.setOptions({
  gfm: true,
  breaks: false,
});

// Ensure links open in new tab and are safe
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) => {
  const t = title ? ` title="${title}"` : '';
  const safeHref = href || '#';
  return `<a href="${safeHref}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.use({ renderer });

const Markdown: React.FC<MarkdownProps> = ({ content, className }) => {
  const html = useMemo(() => {
    // Convert markdown to HTML
    const raw = marked.parse(content ?? '');
    // Sanitize HTML
    const clean = DOMPurify.sanitize(raw as string, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel'],
    });
    return clean;
  }, [content]);

  return (
    <div
      className={[
        // Some sensible defaults; consumers can override via className
        'markdown-container text-sm leading-relaxed',
        // Paragraph spacing and line-height for readability
        '[&_p]:mt-2 [&_p]:mb-3 [&_p]:leading-7',
        // Trim outer spacing so bubbles don't look too roomy
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        // Headings sizing within bubbles + spacing
        '[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-2',
        '[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-2',
        '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1',
        // Lists
        '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-1',
        '[&_ul]:my-3 [&_ol]:my-3',
        // Code styling
        '[&_pre]:overflow-x-auto [&_pre]:bg-black/10 [&_pre]:p-3 [&_pre]:rounded-md [&_code]:whitespace-pre-wrap [&_code]:text-inherit',
        '[&_pre]:my-3',
        // Inline code
        '[&_p_code]:bg-black/10 [&_p_code]:px-1.5 [&_p_code]:py-0.5 [&_p_code]:rounded',
        // Tables
        '[&_table]:w-full [&_table]:block [&_table]:overflow-x-auto [&_th]:text-left [&_th,td]:border [&_th,td]:border-brand-surface-light [&_th,td]:px-3 [&_th,td]:py-2',
        '[&_table]:my-3',
        // Blockquotes and dividers
        '[&_blockquote]:border-l-4 [&_blockquote]:border-brand-surface-light [&_blockquote]:pl-3 [&_blockquote]:my-3 [&_blockquote]:text-brand-text-light',
        '[&_hr]:my-4 [&_hr]:border-brand-surface-light',
        // Word wrapping
        '[&_*]:break-words',
        className || '',
      ].join(' ')}
      // We rely on DOMPurify to keep this safe
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default Markdown;
