import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESEARCH_SYSTEM_PROMPT = `You are a research analyst for Cerebro, Pedro Avila's AI automation consultancy.

TARGET AUDIENCE: Solopreneurs and small service businesses (personal trainers, coaches, consultants, tradespeople, clinics, studios, 1-5 person teams). Core pains: missed leads, slow admin, manual follow-up, scheduling chaos.

Based on your knowledge of Reddit (r/smallbusiness, r/entrepreneur, r/freelance, r/personaltraining, r/consulting) and industry discussions, identify what this audience is struggling with right now around workflow, admin, AI tools, and automation.

Output exactly this format:

RESEARCH FINDINGS:
[3-5 bullet points of what people are actually saying, with specific examples]

TOP PAIN POINTS:
[Top 3 specific pains]

2 BLOG ANGLES:
1. [Short title] | [Target: who specifically] | [Unique insight]
2. [Short title] | [Target: who specifically] | [Unique insight]

Each angle must be contrarian or surprising, with a unique insight only a builder-thinker with a PT background would notice.`;

const BLOG_SYSTEM_PROMPT = `You are writing a blog post for Cerebro (cerebroai.au) in Pedro Avila's voice. Pedro is 36, Brazilian-born, Sydney-based. He runs a PT practice and builds AI automation for small businesses.

VOICE:
- Write like talking to a friend who runs a small business
- Short sentences. Short paragraphs.
- NEVER use em dashes. Never.
- No corporate filler words
- No hedging
- First person, draw on real experience
- Dry humor

STRUCTURE:
1. HOOK (1-2 sentences): Bold specific claim, no throat-clearing
2. SITUATION (3-4 short paragraphs): Expand the problem with real industry examples
3. THE TURN (1 line): "Here's the thing." or "Here's where it gets interesting."
4. UNIQUE INSIGHT (2-3 paragraphs): The aha moment
5. WHAT THIS LOOKS LIKE (1-2 paragraphs): One concrete example ("A physio I know...")
6. WHAT TO DO (1 paragraph): One specific actionable thing
7. CLOSE: One inevitable line, then "ps:" with a nuancing thought

Return ONLY valid JSON. No markdown fences. No text before or after.

{"title":"Under 70 chars","slug":"kebab-case","meta_description":"Under 160 chars","hook":"First 1-2 sentences only","content_md":"Full post 1000-1400 words"}`;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('\n')
    .trim();
}

function parseJsonSafely(raw: string): Record<string, string> | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const debug: string[] = [];

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    debug.push(`env: url=${!!supabaseUrl}, anon=${!!supabaseAnonKey}, service=${!!serviceRoleKey}`);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return respond({ error: 'Unauthorized' }, 401);
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    debug.push(`anthropic: key=${!!Deno.env.get('ANTHROPIC_API_KEY')}`);

    // PHASE 1: Knowledge-based research (no web search — keeps runtime under 60s)
    debug.push('starting research');
    let researchContext = '';
    try {
      const researchResponse = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: RESEARCH_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: 'Based on your knowledge of Reddit and industry discussions: what are small business owners, coaches, consultants, and personal trainers struggling with most right now around workflow, admin, AI tools, and automation? Output 2 unique blog angles in the required format.',
        }],
      });
      researchContext = extractText(researchResponse.content);
      debug.push(`research done: ${researchContext.length} chars`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      debug.push(`research error: ${msg}`);
      return respond({ error: `Research failed: ${msg}`, debug });
    }

    if (!researchContext) {
      return respond({ error: 'Research returned no content', debug });
    }

    // PHASE 2: Generate 2 blog drafts in parallel
    debug.push('starting blog generation');
    const blogResults = await Promise.allSettled([1, 2].map((i) =>
      anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: BLOG_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Research:\n\n${researchContext}\n\nWrite blog post ${i} using angle ${i}. Return ONLY the JSON object.`,
        }],
      })
    ));

    const serviceSupabase = createClient(supabaseUrl, serviceRoleKey);
    const insertedIds: string[] = [];

    for (let i = 0; i < blogResults.length; i++) {
      const result = blogResults[i];

      if (result.status === 'rejected') {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        debug.push(`draft ${i + 1} api failed: ${msg}`);
        continue;
      }

      const raw = extractText(result.value.content);
      debug.push(`draft ${i + 1} raw length: ${raw.length}, first 100: ${raw.slice(0, 100)}`);

      if (!raw) {
        debug.push(`draft ${i + 1}: no text content`);
        continue;
      }

      const blogData = parseJsonSafely(raw);
      if (!blogData || !blogData.title || !blogData.content_md) {
        debug.push(`draft ${i + 1}: json parse failed or missing fields`);
        continue;
      }

      const finalSlug = `${blogData.slug || slugify(blogData.title)}-${Date.now().toString(36)}-${i}`;

      const { data: post, error: insertError } = await serviceSupabase
        .from('blog_posts')
        .insert({
          title: blogData.title,
          slug: finalSlug,
          topic: blogData.title,
          content_md: blogData.content_md,
          meta_description: blogData.meta_description ?? null,
          status: 'research_draft',
          research_context: researchContext,
          author: 'Pedro Avila',
        })
        .select('id')
        .single<{ id: string }>();

      if (insertError || !post) {
        debug.push(`draft ${i + 1} insert error: ${insertError?.message ?? 'no post returned'}`);
        continue;
      }

      insertedIds.push(post.id);
      debug.push(`draft ${i + 1} inserted: ${post.id}`);
    }

    if (insertedIds.length === 0) {
      return respond({ error: 'Failed to save any drafts', debug });
    }

    return respond({ post_ids: insertedIds, debug });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    debug.push(`unhandled: ${msg}`);
    return respond({ error: msg, debug });
  }
});
