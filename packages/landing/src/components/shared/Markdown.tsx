import type { FC } from 'react';
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';

const urlTransform = (url: string) =>
  url.startsWith('data:image/') ? url : defaultUrlTransform(url);

type HastNode = {
  type?: string;
  value?: string;
  children?: HastNode[];
};

const hastText = (node: HastNode | undefined): string => {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join(' ');
};

const KEY_FINDING = /^\s*(?:\*\*)?(?:key findings?|tl;dr|bottom line)/i;

const components: Components = {
  blockquote: ({ node, children, ...props }) => {
    const text = hastText(node as HastNode | undefined);
    if (KEY_FINDING.test(text)) {
      return (
        <aside
          className="border-primary/50 bg-primary/5 my-6 rounded-r-xl border-l-4 px-5 py-4"
          {...props}>
          {children}
        </aside>
      );
    }
    return <blockquote {...props}>{children}</blockquote>;
  },
};

const Markdown: FC<{ content: string }> = ({ content }) => {
  return (
    <div data-testid="markdown" className="prose prose-neutral max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeSlug]}
        components={components}
        urlTransform={urlTransform}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default Markdown;
