import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const BLOG_SYSTEM_PROMPT = `You are a writer for Cerebro, Pedro Avila's embedded AI systems consultancy. Pedro is the founder, Brazilian-born, Sydney-based, with experience across construction, fitness, products, and building software.

VOICE RULES
- Calm, direct, practical. Like a smart friend who has run service businesses for ten years.
- Short sentences. Short paragraphs. White space is your friend.
- Never use em dashes (— or --). Restructure the sentence instead.
- No corporate transitions: "moreover," "furthermore," "in conclusion."
- No hype: no "10x," "disrupt," "game-changer," "revolutionary."
- No "I'm excited to share" energy.
- No bullet-point overload — use prose. A few bullets in a list is fine, but prose first.
- Lead with the reader's problem. Always.

AUDIENCE
Owners and leaders of expert-led service firms, usually 10 to 50 people. Construction advisory, engineering, finance, consulting, legal, accounting, specialist agencies, and established fitness operators. Their constraint is delivery capacity: expensive people doing repeatable data, reporting, document, and coordination work. They want more output without matching headcount, not technology lectures.

OUTPUT FORMAT
Return ONLY a valid JSON object with these exact fields. No markdown fences. No preamble.

{
  "title": "The blog post title — clear, direct, benefit-led, no clickbait",
  "slug": "kebab-case-version-of-title-max-60-chars",
  "meta_description": "1-2 sentence SEO description under 160 chars",
  "content_md": "Full blog post in markdown. 1,800 to 2,200 words. Structure below."
}

CONTENT STRUCTURE (inside content_md)
- Opening paragraph: 2-3 sentences. Name the reader's problem directly. No throat-clearing.
- 4 to 6 sections with ## H2 headings. Each section: 200-350 words of prose.
- At least one practical, specific takeaway per section.
- Closing section titled "What to do next" — 100-150 words. Ends with a soft CTA: "If your best people keep rebuilding the same work, [Cerebro](https://cerebroai.au) is a good place to map the first system."
- Do not write a generic introduction paragraph that explains what you're about to explain. Just start.`;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/-$/, '');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify the user's session
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { topic, notes } = (await req.json()) as { topic: string; notes?: string };
    if (!topic?.trim()) {
      return new Response(JSON.stringify({ error: 'topic is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    const userPrompt = `Write a blog post for Cerebro on this topic:

TOPIC: ${topic}
${notes ? `\nNOTES / ANGLE / KEY POINTS TO INCLUDE:\n${notes}` : ''}

Return the JSON object as specified. No other text.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: BLOG_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = response.content[0]?.type === 'text'
      ? response.content[0].text.replace(/```json\n?|\n?```/g, '').trim()
      : '{}';

    let blogData: { title: string; slug: string; meta_description: string; content_md: string };
    try {
      blogData = JSON.parse(raw);
    } catch {
      console.error('Blog JSON parse error. Raw:', raw.slice(0, 500));
      return new Response(JSON.stringify({ error: 'Failed to parse AI response' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ensure slug is unique — append a short timestamp suffix if needed
    const baseSlug = blogData.slug || slugify(blogData.title);
    const finalSlug = `${baseSlug}-${Date.now().toString(36)}`;

    // Use service role client for writing
    const serviceSupabase = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: post, error: insertError } = await serviceSupabase
      .from('blog_posts')
      .insert({
        title: blogData.title,
        slug: finalSlug,
        topic,
        notes: notes ?? null,
        content_md: blogData.content_md,
        meta_description: blogData.meta_description,
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select()
      .single<{ id: string; slug: string }>();

    if (insertError || !post) {
      console.error('Blog insert error:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to save blog post' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fire-and-forget social draft generation
    const socialKickoff = fetch(
      `${supabaseUrl}/functions/v1/generate-social-drafts`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ blog_post_id: post.id }),
      },
    ).catch((err) => console.error('Social draft kickoff failed:', err));

    // @ts-ignore
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(socialKickoff);
    }

    return new Response(
      JSON.stringify({ blog_id: post.id, slug: post.slug }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('generate-blog error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
