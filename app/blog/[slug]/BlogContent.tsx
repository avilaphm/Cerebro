'use client';

import ReactMarkdown from 'react-markdown';

export default function BlogContent({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-sm max-w-none blog-prose">
      <ReactMarkdown>{markdown}</ReactMarkdown>
    </div>
  );
}
