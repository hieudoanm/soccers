import type { FC } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

const urlTransform = (url: string) =>
  url.startsWith('data:image/') ? url : defaultUrlTransform(url);

const Markdown: FC<{ content: string }> = ({ content }) => {
  return (
    <div data-testid="markdown" className="prose prose-neutral max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        urlTransform={urlTransform}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default Markdown;
