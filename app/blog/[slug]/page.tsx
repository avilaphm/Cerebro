import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Nav from '@/app/components/Nav';
import { createClient } from '@/utils/supabase/server';
import BlogContent from './BlogContent';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: post } = await supabase
    .from('blog_posts')
    .select('title, meta_description')
    .eq('slug', slug)
    .eq('status', 'published')
    .single<{ title: string; meta_description: string }>();

  if (!post) return { title: 'Not found' };

  return {
    title: `${post.title} — Cerebro`,
    description: post.meta_description,
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: post } = await supabase
    .from('blog_posts')
    .select('id, title, slug, content_md, published_at, author, meta_description')
    .eq('slug', slug)
    .eq('status', 'published')
    .single<{
      id: string;
      title: string;
      slug: string;
      content_md: string;
      published_at: string | null;
      author: string;
      meta_description: string;
    }>();

  if (!post) notFound();

  const date = post.published_at
    ? new Date(post.published_at).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

  return (
    <>
      <Nav />
      <div className="min-h-screen bg-white pt-24 pb-32 px-6 md:px-12">
        <div className="max-w-2xl mx-auto">
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/30 mb-8">
            {date}
          </p>
          <h1 className="font-display text-[clamp(1.8rem,4vw,3rem)] font-light tracking-[-0.025em] text-black mb-12 leading-tight">
            {post.title}
          </h1>

          <BlogContent markdown={post.content_md ?? ''} />

          <div className="mt-16 pt-8 border-t border-black/10">
            <p className="text-xs text-black/30">
              By {post.author} &middot; Cerebro
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
