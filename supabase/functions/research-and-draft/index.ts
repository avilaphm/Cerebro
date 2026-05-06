import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESEARCH_SYSTEM_PROMPT = `You are a research analyst for Cerebro, Pedro Avila's AI automation consultancy targeting small business owners, solopreneurs, coaches, consultants, and service businesses.

TARGET AUDIENCE:
- Solopreneurs and micro-teams (1-5 people): personal trainers, coaches, consultants, tradespeople, healthcare practitioners
- Small service businesses: boutique agencies, clinics, studios
- Core pains: missed leads, slow admin, manual follow-up, repetitive reporting, scheduling chaos, context switching
- They want relief. Less behind, more professional, more in control.

Search for what this audience is actively struggling with, talking about, and searching for right now. Look for:
- Reddit discussions in r/smallbusiness, r/entrepreneur, r/freelance, r/personaltraining, r/consulting
- Trending questions about workflow problems, AI tools, admin burden, automation
- Common complaints from service business owners about time and admin
- Underexplored angles that a content marketer would miss but a builder-thinker would notice

After researching, output exactly this format:

RESEARCH FINDINGS:
[3-5 bullet points of what people are actually saying right now, with specific examples]

TOP PAIN POINTS:
[Top 3 specific pains with evidence from research]

3 BLOG ANGLES:
1. [Short title] | [Target: who specifically] | [Unique insight: what dots does this connect that nobody else is connecting?]
2. [Same format]
3. [Same format]

Each angle must: target a slightly different persona or moment, lead with something contrarian or surprising, and have a unique insight that only Pedro (builder + PT background) would notice.`;

const BLOG_SYSTEM_PROMPT = `You are writing a blog post for Cerebro (cerebroai.au) in Pedro Avila's voice. Pedro is 36, Brazilian-born, Sydney-based. He runs a PT practice and builds AI automation for small businesses. Builder-thinker.

VOICE — NON-NEGOTIABLE:
- Write like talking to a friend who runs a small business. Not like a content marketer.
- Short sentences. Short paragraphs. White space is pacing.
- NEVER use em dashes (— or --). Never. Restructure the sentence.
- No "moreover," "furthermore," "in conclusion," "in today's fast-paced world"
- No "game-changer," "10x," "disrupt," "revolutionary," "unlock"
- No "I'm excited to share" energy. Just say the thing.
- No hedging: no "perhaps," "it could be argued," "some might say"
- Contrarian by default. Bold claim, then immediately acknowledge the nuance.
- First person. Draw on PT experience, building things, running businesses.
- Dry humor. Self-aware. Not trying to be funny, just is.

SIGNATURE WORDS (use naturally):
- "really" as intensifier: "really good actually"
- "actually" mid or end of sentence
- "I reckon" for soft assertions
- "Here's the thing" / "Here's where it gets interesting" as pivot phrases
- "Anyway," as a standalone pivot line
- "ps:" (lowercase) as a closing caveat after the post ends

BLOG STRUCTURE (follow this exactly, no H2 headers except optional in section 5):
1. HOOK (1-2 sentences): Name the problem directly or make a surprising specific claim. No throat-clearing. Never start with "In today's..." or "If you're a small business owner..."
2. SITUATION (3-4 short paragraphs): Expand the problem. Specific. Real. Use industry examples: personal training, trades, coaching, consulting. First person when it adds authenticity.
3. THE TURN (1 short standalone line): "Here's where it gets interesting." or "Here's the thing." or "And here's what nobody actually talks about." This is the pivot to insight.
4. UNIQUE INSIGHT (2-3 paragraphs): The aha moment. Connect dots the reader hasn't connected. This is the whole point of the post. Be specific, not vague.
5. WHAT THIS LOOKS LIKE (1-2 paragraphs): One concrete example. "A physio I know..." "My client who runs a 4-person marketing agency..." Make it feel real.
6. WHAT TO DO (1 paragraph): One clear, specific, immediately actionable thing. Not a list. One thing.
7. CLOSE: A single standalone line that feels inevitable, like the reader was already getting there. Then a new line: "ps:" with one nuancing thought.

OUTPUT: Return ONLY a valid JSON object. No markdown fences. No preamble. No trailing text.

{
  "title": "Specific, benefit-led title. No clickbait. Under 70 chars.",
  "slug": "kebab-case-max-60-chars",
  "meta_description": "1-2 sentences under 160 chars",
  "hook": "The first 1-2 sentences of the post only (for card preview)",
  "content_md": "Full post in markdown, 1,200-1,600 words, following structure above exactly"
}`;

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

function parseJsonSafely(raw: string): { title: string; slug: string; meta_description: string; hook: string; content_md: string } | null {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Find the first { and last } to extract just the JSON object
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

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

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

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    // PHASE 1: Research (with web search, fallback to knowledge-based)
    let researchContext = '';

    try {
      const researchResponse = await (anthropic as any).messages.create(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: RESEARCH_SYSTEM_PROMPT,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{
            role: 'user',
            content: 'Search Reddit, forums, and recent articles to find what small business owners, solopreneurs, coaches, consultants, and personal trainers are actively struggling with right now in terms of workflow, admin burden, AI tools, and business automation. Then give me 3 unique blog angles based on your findings.',
          }],
        },
        { headers: { 'anthropic-beta': 'web-search-2025-03-05' } },
      );
      researchContext = extractText(researchResponse.content);
    } catch (_err) {
      console.error('Web search failed, using fallback:', _err);
    }

    if (!researchContext) {
      // Fallback: knowledge-based research
      try {
        const fallback = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: RESEARCH_SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: 'Based on your knowledge of discussions on Reddit, forums, and industry conversations: what are small business owners, solopreneurs, coaches, consultants, and personal trainers struggling with most right now around workflow, admin, AI tools, and automation? Give me specific examples from real discussions you know about. Output 3 unique blog angles following the required format.',
          }],
        });
        researchContext = extractText(fallback.content);
      } catch (fallbackErr) {
        console.error('Fallback research also failed:', fallbackErr);
      }
    }

    if (!researchContext) {
      return new Response(JSON.stringify({ error: 'Research returned no content' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PHASE 2: Generate 3 blog drafts in parallel (allSettled so one failure doesn't kill all)
    const blogPromises = [1, 2, 3].map((i) =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: BLOG_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Based on this research:\n\n${researchContext}\n\nWrite blog post option ${i} — use angle number ${i} from the "3 BLOG ANGLES" list above. Make it distinctly different from the others in entry point, persona, and insight. Return ONLY the JSON object with no extra text.`,
        }],
      })
    );

    const blogResults = await Promise.allSettled(blogPromises);

    // Save successful drafts
    const serviceSupabase = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const insertedIds: string[] = [];

    for (let i = 0; i < blogResults.length; i++) {
      const result = blogResults[i];

      if (result.status === 'rejected') {
        console.error(`Draft ${i + 1} API call failed:`, result.reason);
        continue;
      }

      const raw = extractText(result.value.content);
      if (!raw) {
        console.error(`Draft ${i + 1} returned no text content`);
        continue;
      }

      const blogData = parseJsonSafely(raw);
      if (!blogData) {
        console.error(`Draft ${i + 1} JSON parse error. Raw (first 300 chars):`, raw.slice(0, 300));
        continue;
      }

      if (!blogData.title || !blogData.content_md) {
        console.error(`Draft ${i + 1} missing required fields`);
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
        console.error(`Draft ${i + 1} insert error:`, insertError?.message);
        continue;
      }

      insertedIds.push(post.id);
    }

    if (insertedIds.length === 0) {
      return new Response(JSON.stringify({ error: 'Failed to save any drafts. Check function logs for details.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ post_ids: insertedIds }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('research-and-draft unhandled error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
