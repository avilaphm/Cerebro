import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BASE_VOICE = `You write X (Twitter) posts for Pedro Avila, founder of Cerebro (cerebroai.au), an AI automation consultancy for small service businesses.

PEDRO'S VOICE:
- Calm, direct, observational. Sounds like a smart person thinking out loud, not a marketer.
- Short sentences. No em dashes. No corporate speak. No hype.
- Dry humor. Self-aware. First person.
- Never starts with "I" (weak). Never asks "Have you ever..."
- Specific over vague. "6 leads gone by Monday morning" beats "many missed leads".

X BEST PRACTICES (what actually performs):
- The first line is everything — it's the only thing visible before "show more". If it doesn't stop the scroll, nothing else matters.
- Contrarian angles outperform agreeable ones. Start with the unexpected take, then back it up.
- Numbers and specifics drive engagement. Real figures, real scenarios.
- Don't explain your tweet. Say the thing. Let readers complete the thought.
- Cliffhangers work. A first line that creates a knowledge gap makes people tap "show more".
- No hashtags. They look desperate on X in 2025.
- No "RT if you agree" / "drop a comment" / "thread below 🧵" — all engagement-bait tells.
- Under 280 characters per tweet. Tight. No filler.
- Soft CTAs only: "wrote about this at cerebroai.au" if it fits naturally. Never forced.`;

const ALL_TYPES = [
  { type: 'hook', desc: 'HOOK — The core insight as a pattern-interrupt. One idea. Under 180 chars. Feels inevitable once you read it.' },
  { type: 'contrarian', desc: 'CONTRARIAN — Starts with the unexpected claim from the blog. Makes the reader go "wait, really?"' },
  { type: 'specific', desc: 'SPECIFIC — Grounded in a concrete scenario or example from the blog. Real and tactile.' },
  { type: 'thread_opener', desc: 'THREAD_OPENER — First tweet of a thread. Creates enough curiosity that people want the rest. Ends with "Thread:" on its own line.' },
  { type: 'observation', desc: 'OBSERVATION — A broader industry truth connected to the blog\'s theme. Feels like a shower thought that turned out to be correct.' },
];

function buildSystemPrompt(count: number): string {
  const types = ALL_TYPES.slice(0, count);
  const typeList = types.map((t, i) => `${i + 1}. ${t.desc}`).join('\n');
  const example = types.map((t) => `  {"type":"${t.type}","content":"..."}`).join(',\n');

  return `${BASE_VOICE}

Generate exactly ${count} X post${count > 1 ? 's' : ''} from the blog content, each with a distinct angle:

${typeList}

Return ONLY a valid JSON array of exactly ${count} object${count > 1 ? 's' : ''}. No markdown fences. No preamble.

[\n${example}\n]`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return respond({ error: 'Unauthorized' }, 401);

    const body = (await req.json()) as { blog_post_id: string; count?: number };
    const { blog_post_id } = body;
    const count = [1, 3, 5].includes(body.count ?? 5) ? (body.count ?? 5) : 5;

    if (!blog_post_id) return respond({ error: 'blog_post_id required' }, 400);

    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: post } = await serviceSupabase
      .from('blog_posts')
      .select('title, slug, content_md, meta_description')
      .eq('id', blog_post_id)
      .single<{ title: string; slug: string; content_md: string; meta_description: string }>();

    if (!post) return respond({ error: 'Blog post not found' }, 404);

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    const blogContext = `TITLE: ${post.title}
URL: cerebroai.au/blog/${post.slug}
META: ${post.meta_description ?? ''}

CONTENT:
${(post.content_md ?? '').slice(0, 4000)}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: buildSystemPrompt(count),
      messages: [{ role: 'user', content: `Generate ${count} X post${count > 1 ? 's' : ''} from this blog post:\n\n${blogContext}` }],
    });

    const raw = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as Anthropic.TextBlock).text)
      .join('')
      .trim();

    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) {
      return respond({ error: 'Model did not return valid JSON array', raw: raw.slice(0, 200) });
    }

    let posts: { type: string; content: string }[];
    try {
      posts = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return respond({ error: 'JSON parse failed', raw: raw.slice(0, 200) });
    }

    if (!Array.isArray(posts) || posts.length === 0) {
      return respond({ error: 'Empty or invalid posts array' });
    }

    const rows = posts.map((p) => ({
      blog_post_id,
      platform: 'twitter',
      content: p.content ?? '',
      post_type: p.type ?? 'single',
      status: 'draft',
    }));

    const { data: inserted, error: insertError } = await serviceSupabase
      .from('social_drafts')
      .insert(rows)
      .select('id');

    if (insertError) {
      return respond({ error: insertError.message });
    }

    return respond({ draft_ids: inserted?.map((r: { id: string }) => r.id) ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return respond({ error: msg });
  }
});
