import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditBlog,
  BLOG_REFINER_SYSTEM,
  extractText,
  removeDashPunctuation,
} from '../_shared/blog-system.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function markdownUrls(content: string): string[] {
  return [...content.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1]);
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

    const serviceSupabase = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: blog } = await serviceSupabase
      .from('blog_posts')
      .select('research_context, qc_report')
      .eq('id', blog_id)
      .single<{ research_context: string | null; qc_report: Record<string, unknown> | null }>();

    if (!blog) {
      return new Response(JSON.stringify({ error: 'Blog post not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const originalUrls = markdownUrls(current_content);
    const researchContext = blog.research_context || '(No research packet is linked. Do not add new factual claims.)';

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 6500,
      system: BLOG_REFINER_SYSTEM,
      messages: [{
        role: 'user',
        content: `RESEARCH PACKET\n${researchContext}\n\nCURRENT ARTICLE\n${current_content}\n\nPEDRO'S REQUEST\n${message}\n\nReturn the full updated article as Markdown only.`,
      }],
    });

    let refined = removeDashPunctuation(
      extractText(response.content as unknown[]) || current_content,
    );
    let auditIssues = auditBlog(refined);
    const removedUrls = originalUrls.filter((url) => !refined.includes(`](${url})`));
    if (removedUrls.length > 0) {
      auditIssues.push(`Restore these source links or remove the claims they supported: ${removedUrls.join(', ')}`);
    }

    if (auditIssues.length > 0) {
      const repairResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 6500,
        system: BLOG_REFINER_SYSTEM,
        messages: [{
          role: 'user',
          content: `RESEARCH PACKET\n${researchContext}\n\nARTICLE TO REPAIR\n${refined}\n\nEDITORIAL ISSUES\n${auditIssues.map((issue) => `- ${issue}`).join('\n')}\n\nRepair only these issues. Return the complete Markdown article.`,
        }],
      });
      refined = removeDashPunctuation(
        extractText(repairResponse.content as unknown[]) || refined,
      );
      auditIssues = auditBlog(refined);
    }

    // Persist the refined content
    await serviceSupabase
      .from('blog_posts')
      .update({
        content_md: refined,
        qc_report: {
          ...(blog.qc_report ?? {}),
          refinement_issues: auditIssues,
          refined_at: new Date().toISOString(),
        },
      })
      .eq('id', blog_id);

    return new Response(
      JSON.stringify({ content: refined, qc_issues: auditIssues }),
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
