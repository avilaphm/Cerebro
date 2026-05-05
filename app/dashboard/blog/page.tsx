import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';

interface BlogPost {
  id: string;
  created_at: string;
  title: string;
  slug: string;
  status: string;
  published_at: string | null;
  social_drafts: { platform: string; status: string }[];
}

export default async function BlogDashboardPage() {
  const supabase = await createClient();

  const { data: posts } = await supabase
    .from('blog_posts')
    .select('id, created_at, title, slug, status, published_at, social_drafts(platform, status)')
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = (posts ?? []) as BlogPost[];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
            Dashboard
          </p>
          <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black">
            Blog
          </h1>
        </div>
        <Link
          href="/dashboard/blog/new"
          className="bg-black text-white text-sm px-5 py-2.5 rounded-xl hover:opacity-80 transition-opacity"
        >
          New post
        </Link>
      </div>

      <div className="border border-black/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10">
              <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Title</th>
              <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Published</th>
              <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">Social</th>
              <th className="text-left px-5 py-3 text-xs font-medium tracking-wide text-black/40">View</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-black/30 text-sm">
                  No posts yet.{' '}
                  <Link href="/dashboard/blog/new" className="underline">
                    Write your first one.
                  </Link>
                </td>
              </tr>
            )}
            {rows.map((post) => {
              const date = post.published_at
                ? new Date(post.published_at).toLocaleDateString('en-AU', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : '—';
              const hasDrafts = post.social_drafts?.length > 0;
              const allPosted = hasDrafts && post.social_drafts.every((d) => d.status === 'posted');

              return (
                <tr key={post.id} className="border-b border-black/5 hover:bg-black/2 transition-colors">
                  <td className="px-5 py-3.5 text-black font-medium max-w-xs">
                    <span className="line-clamp-1">{post.title}</span>
                  </td>
                  <td className="px-5 py-3.5 text-black/40 whitespace-nowrap">{date}</td>
                  <td className="px-5 py-3.5">
                    {hasDrafts ? (
                      <span
                        className={`inline-block text-xs px-2 py-0.5 rounded-full ${
                          allPosted ? 'bg-black text-white' : 'bg-black/10 text-black/60'
                        }`}
                      >
                        {allPosted ? 'posted' : 'drafts ready'}
                      </span>
                    ) : (
                      <span className="text-black/20 text-xs">generating…</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/blog/${post.slug}`}
                      target="_blank"
                      className="text-black/40 hover:text-black transition-colors text-xs"
                    >
                      ↗ open
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
