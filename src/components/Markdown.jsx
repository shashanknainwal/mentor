import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';

function CodeBlock({ className, children }) {
  const [copied, setCopied] = useState(false);
  const lang = /language-(\w+)/.exec(className || '')?.[1];
  const text = String(children).replace(/\n$/, '');
  return (
    <pre>
      {lang && <span className="lang">{lang}</span>}
      <button
        className="btn icon sm copy"
        aria-label="Copy code"
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <code className={className}>{text}</code>
    </pre>
  );
}

const components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...rest }) => {
    const isBlock = /language-/.test(className || '') || String(children).includes('\n');
    return isBlock ? <CodeBlock className={className}>{children}</CodeBlock> : <code {...rest}>{children}</code>;
  },
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        if (window.mentor?.openExternal && href?.startsWith('http')) {
          e.preventDefault();
          window.mentor.openExternal(href);
        }
      }}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
};

export const Markdown = memo(function Markdown({ children }) {
  const text = (children || '').replace(/\s*\[(artifact|deck):[a-z0-9_]+\]/g, '');
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
