import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LINKEDIN_PROMPT = `You write LinkedIn posts for Pedro Avila, founder of Cerebro (cerebroai.au), an AI automation consultancy for small businesses.

Pedro's voice: calm, direct, practical. Like a smart founder who has lived service business pain. Short sentences. No em dashes. No corporate speak. No "I'm excited to share." No hype. Lead with the reader's problem.

Write a LinkedIn post based on the blog post content provided. Format:
- 150 to 220 words
- No hashtags (they look cheap)
- Plain paragraphs — no bullet lists
- First line is the hook: a short, specific statement that names a pain or an observation. Not a question. Not "Have you ever..."
- End with a soft, natural CTA — not "check out my link" energy. Something like: "Full breakdown at cerebroai.au" or "I wrote about this in more detail — link in comments."
- Sign off naturally, no signature needed

Return ONLY the post text. No labels. No JSON.`;

const TWITTER_PROMPT = `You write X (Twitter) posts for Pedro Avila, founder of Cerebro (cerebroai.au).

Pedro's voice: calm, direct, observational. Short. Punchy without being loud. No em dashes.

Write a single tweet (not a thread) based on the blog post content. Rules:
- Under 260 characters
- States one sharp, specific insight from the blog
- Ends naturally — no hashtags, no "RT if you agree", no "drop a comment"
- Optionally include the URL: cerebroai.au/blog/[slug] but only if it fits naturally

Return ONLY the tweet text. No labels. No JSON.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // This function is called internally — accept service role key as bearer token
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { blog_post_id } = (await req.json()) as { blog_post_id: string };
    if (!blog_post_id) {
      return new Response(JSON.stringify({ error: 'blog_post_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: post } = await supabase
      .from('blog_posts')
      .select('title, slug, content_md, meta_description')
      .eq('id', blog_post_id)
      .single<{ title: string; slug: string; content_md: string; meta_description: string }>();

    if (!post) {
      return new Response(JSON.stringify({ error: 'Blog post not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    const blogContext = `BLOG TITLE: ${post.title}
BLOG SLUG: ${post.slug}
META DESCRIPTION: ${post.meta_description}

BLOG CONTENT:
${post.content_md?.slice(0, 3000) ?? ''}`;

    // Generate LinkedIn and X posts in parallel
    const [linkedinRes, twitterRes] = await Promise.all([
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: LINKEDIN_PROMPT,
        messages: [{ role: 'user', content: blogContext }],
      }),
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 128,
        system: TWITTER_PROMPT,
        messages: [{ role: 'user', content: blogContext }],
      }),
    ]);

    const linkedinContent =
      linkedinRes.content[0]?.type === 'text' ? linkedinRes.content[0].text.trim() : '';
    const twitterContent =
      twitterRes.content[0]?.type === 'text' ? twitterRes.content[0].text.trim() : '';

    // Save both drafts
    const { error: draftError } = await supabase.from('social_drafts').insert([
      { blog_post_id, platform: 'linkedin', content: linkedinContent, status: 'draft' },
      { blog_post_id, platform: 'twitter', content: twitterContent, status: 'draft' },
    ]);

    if (draftError) {
      console.error('Social draft insert error:', draftError);
    } else {
      console.log('Social drafts saved for blog post:', blog_post_id);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('generate-social-drafts error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
