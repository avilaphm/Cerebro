import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import Nav from '@/app/components/Nav';

export const metadata = {
  title: 'Blog — Cerebro',
  description: 'Practical thinking on automation and running a small business.',
};

export default async function BlogListPage() {
  const supabase = await createClient();

  const { data: posts } = await supabase
    .from('blog_posts')
    .select('id, title, slug, meta_description, published_at, author')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  const rows = posts ?? [];

  return (
    <>
      <Nav />
      <div className="min-h-screen bg-white pt-24 pb-24 px-6 md:px-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-6">
            Blog
          </p>
          <h1 className="font-display text-[clamp(2rem,4vw,3.5rem)] font-light tracking-[-0.025em] text-black mb-16">
            Thinking out loud.
          </h1>

          {rows.length === 0 && (
            <p className="text-sm text-black/40">No posts yet. Check back soon.</p>
          )}

          <div className="divide-y divide-black/10">
            {rows.map((post) => {
              const date = post.published_at
                ? new Date(post.published_at).toLocaleDateString('en-AU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })
                : '';
              return (
                <article key={post.id} className="py-8 group">
                  <Link href={`/blog/${post.slug}`} className="block no-underline">
                    <p className="text-xs text-black/30 mb-2">{date}</p>
                    <h2 className="font-display text-xl font-light tracking-[-0.01em] text-black mb-2 group-hover:opacity-60 transition-opacity">
                      {post.title}
                    </h2>
                    {post.meta_description && (
                      <p className="text-sm font-light text-black/50 leading-relaxed">
                        {post.meta_description}
                      </p>
                    )}
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
