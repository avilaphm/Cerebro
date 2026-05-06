import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REFINE_SYSTEM_PROMPT = `You are helping Pedro Avila (founder of Cerebro) refine a blog post draft. Pedro's voice rules — all non-negotiable:

- NEVER use em dashes (— or --). Restructure the sentence.
- No "moreover," "furthermore," "in conclusion"
- No "game-changer," "10x," "disrupt," "revolutionary"
- No hedging: "perhaps," "could be argued," "some might say"
- Short sentences. Short paragraphs. Write like talking to a friend.
- Contrarian by default. Bold claims with immediate nuance.
- First person. Conversational. Human. Dry humor.
- Signature words where natural: "really," "actually," "I reckon," "Here's the thing," "Anyway,"
- Keep the ps: closing line.

The user will tell you what to change or explore. Apply their request to the blog post while keeping everything else in Pedro's voice. Return ONLY the full updated blog post as markdown. No preamble. No explanation. Just the content.`;

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

    const { blog_id, message, current_content } = await req.json() as {
      blog_id: string;
      message: string;
      current_content: string;
    };

    if (!blog_id || !message || !current_content) {
      return new Response(JSON.stringify({ error: 'blog_id, message, and current_content are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: REFINE_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Current blog post:\n\n${current_content}\n\n---\n\nRequest: ${message}\n\nReturn the full updated blog post as markdown only.`,
      }],
    });

    const refined = response.content[0]?.type === 'text'
      ? response.content[0].text.trim()
      : current_content;

    // Persist the refined content
    const serviceSupabase = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    await serviceSupabase
      .from('blog_posts')
      .update({ content_md: refined })
      .eq('id', blog_id);

    return new Response(
      JSON.stringify({ content: refined }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('refine-blog error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
