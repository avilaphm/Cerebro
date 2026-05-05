import { createClient } from '@/utils/supabase/server';

async function getStats() {
  const supabase = await createClient();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    { count: totalLeads },
    { count: newLeads },
    { count: totalBlogs },
    { count: pendingDrafts },
  ] = await Promise.all([
    supabase.from('leads').select('*', { count: 'exact', head: true }),
    supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo.toISOString()),
    supabase
      .from('blog_posts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'published'),
    supabase
      .from('social_drafts')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'draft'),
  ]);

  return {
    totalLeads: totalLeads ?? 0,
    newLeads: newLeads ?? 0,
    totalBlogs: totalBlogs ?? 0,
    pendingDrafts: pendingDrafts ?? 0,
  };
}

export default async function DashboardPage() {
  const stats = await getStats();

  const cards = [
    { label: 'Total leads', value: stats.totalLeads },
    { label: 'New this week', value: stats.newLeads },
    { label: 'Blog posts', value: stats.totalBlogs },
    { label: 'Social drafts pending', value: stats.pendingDrafts },
  ];

  return (
    <div className="p-8">
      <p className="text-[0.65rem] font-medium tracking-[0.2em] uppercase text-black/40 mb-2">
        Dashboard
      </p>
      <h1 className="font-display text-3xl font-light tracking-[-0.02em] text-black mb-10">
        Overview
      </h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        {cards.map((card) => (
          <div
            key={card.label}
            className="border border-black/10 rounded-xl p-6"
          >
            <p className="text-3xl font-display font-light text-black mb-1">
              {card.value}
            </p>
            <p className="text-xs text-black/40 tracking-wide">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="border border-black/10 rounded-xl p-6 max-w-sm">
        <p className="text-sm font-medium text-black mb-1">Quick actions</p>
        <div className="mt-3 space-y-2">
          <a
            href="/dashboard/blog/new"
            className="block text-sm text-black/60 hover:text-black transition-colors"
          >
            Write a new blog post →
          </a>
          <a
            href="/dashboard/leads"
            className="block text-sm text-black/60 hover:text-black transition-colors"
          >
            View all leads →
          </a>
          <a
            href="/dashboard/social"
            className="block text-sm text-black/60 hover:text-black transition-colors"
          >
            Review social drafts →
          </a>
        </div>
      </div>
    </div>
  );
}
