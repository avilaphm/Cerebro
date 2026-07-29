import Anthropic from 'npm:@anthropic-ai/sdk@0.65.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditBlog,
  BLOG_QC_SYSTEM,
  BLOG_RESEARCH_SYSTEM,
  BLOG_WRITER_SYSTEM,
  extractText,
  type BlogAngle,
  type BlogQcResult,
  type BlogResearchPacket,
  type BlogSource,
  type GeneratedBlog,
  normaliseResearchPacket,
  parseJsonObject,
  removeDashPunctuation,
  slugifyBlogTitle,
} from '../_shared/blog-system.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ResearchRequest = {
  action: 'research';
  topic?: string;
  notes?: string;
};

type GenerateRequest = {
  action: 'generate';
  run_id: string;
  angle_index: number;
  notes?: string;
};

type ResearchRunRow = {
  id: string;
  created_by: string;
  seed_topic: string | null;
  notes: string | null;
  findings: string[];
  audience_language: string[];
  angles: BlogAngle[];
  sources: BlogSource[];
};

const webSearchTool = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 4,
  user_location: {
    type: 'approximate',
    city: 'Sydney',
    region: 'New South Wales',
    country: 'AU',
    timezone: 'Australia/Sydney',
  },
} as const;

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function researchPacketFromRun(run: ResearchRunRow): BlogResearchPacket {
  return normaliseResearchPacket({
    findings: run.findings,
    audience_language: run.audience_language,
    angles: run.angles,
    sources: run.sources,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let activeRunId: string | null = null;
  let activeAction: 'research' | 'generate' | null = null;
  let serviceSupabase: ReturnType<typeof createClient> | null = null;

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');

    if (!anthropicKey) return respond({ error: 'ANTHROPIC_API_KEY is not configured.' }, 500);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return respond({ error: 'Unauthorized' }, 401);

    const input = await req.json() as ResearchRequest | GenerateRequest;
    activeAction = input.action;
    serviceSupabase = createClient(supabaseUrl, serviceRoleKey);
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    if (input.action === 'research') {
      const topic = input.topic?.trim() || null;
      const notes = input.notes?.trim() || null;

      const { data: run, error: runError } = await serviceSupabase
        .from('blog_research_runs')
        .insert({
          created_by: user.id,
          seed_topic: topic,
          notes,
          sector: 'construction, engineering and advisory',
          status: 'researching',
        })
        .select('id')
        .single<{ id: string }>();

      if (runError || !run) {
        console.error('Blog research run insert error:', runError);
        return respond({ error: 'Could not start the research run.' }, 500);
      }
      activeRunId = run.id;

      const topicInstruction = topic
        ? `Start with this topic or operating problem: ${topic}`
        : 'Discover the strongest current construction, engineering, infrastructure or project-controls operating problem worth writing about.';
      const notesInstruction = notes
        ? `Pedro's optional notes. Treat these as direction, not independently verified evidence:\n${notes}`
        : 'Pedro supplied no additional notes.';

      const researchPrompt = `${topicInstruction}\n\n${notesInstruction}\n\nResearch date: ${new Date().toISOString().slice(0, 10)}. Return the required JSON only.`;
      const researchMessages: Array<{
        role: 'user' | 'assistant';
        content: unknown;
      }> = [{
        role: 'user',
        content: researchPrompt,
      }];

      let researchResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 5000,
        system: BLOG_RESEARCH_SYSTEM,
        tools: [webSearchTool],
        messages: researchMessages,
      });

      // Anthropic server tools may pause a long-running turn. Continue with the
      // returned content exactly as documented instead of treating it as a final answer.
      for (let continuation = 0;
        researchResponse.stop_reason === 'pause_turn' && continuation < 2;
        continuation += 1
      ) {
        researchMessages.push({
          role: 'assistant',
          content: researchResponse.content,
        });
        researchResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 5000,
          system: BLOG_RESEARCH_SYSTEM,
          tools: [webSearchTool],
          messages: researchMessages,
        });
      }

      const raw = extractText(researchResponse.content as unknown[]);
      const parsed = parseJsonObject<BlogResearchPacket>(raw);
      const packet = parsed ? normaliseResearchPacket(parsed) : null;

      if (!packet || packet.angles.length !== 3 || packet.sources.length < 3) {
        console.error('Blog research packet validation failed:', {
          stop_reason: researchResponse.stop_reason,
          raw_length: raw.length,
          parsed: Boolean(parsed),
          angles: packet?.angles.length ?? 0,
          sources: packet?.sources.length ?? 0,
        });
        await serviceSupabase
          .from('blog_research_runs')
          .update({
            status: 'failed',
            error: 'Research did not return three usable angles with enough sources.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', run.id);
        return respond({ error: 'Research was too thin to build trustworthy angles. Try a more specific topic.' }, 422);
      }

      const { error: updateError } = await serviceSupabase
        .from('blog_research_runs')
        .update({
          status: 'ready',
          findings: packet.findings,
          audience_language: packet.audience_language,
          angles: packet.angles,
          sources: packet.sources,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', run.id);

      if (updateError) {
        console.error('Blog research run update error:', updateError);
        return respond({ error: 'Research finished but could not be saved.' }, 500);
      }

      return respond({
        run: {
          id: run.id,
          seed_topic: topic,
          sector: 'construction, engineering and advisory',
          status: 'ready',
          ...packet,
        },
      });
    }

    if (input.action === 'generate') {
      if (!input.run_id || !Number.isInteger(input.angle_index)) {
        return respond({ error: 'run_id and angle_index are required.' }, 400);
      }
      activeRunId = input.run_id;

      const { data: run, error: runError } = await serviceSupabase
        .from('blog_research_runs')
        .select('id, created_by, seed_topic, notes, findings, audience_language, angles, sources')
        .eq('id', input.run_id)
        .eq('created_by', user.id)
        .single<ResearchRunRow>();

      if (runError || !run) return respond({ error: 'Research run not found.' }, 404);

      const packet = researchPacketFromRun(run);
      const angle = packet.angles[input.angle_index];
      if (!angle) return respond({ error: 'Selected angle not found.' }, 400);

      const { data: existingPost } = await serviceSupabase
        .from('blog_posts')
        .select('id, slug, title, status')
        .eq('research_run_id', run.id)
        .eq('research_angle_index', input.angle_index)
        .maybeSingle<{
          id: string;
          slug: string;
          title: string;
          status: string;
        }>();

      if (existingPost) {
        return respond({
          post_id: existingPost.id,
          slug: existingPost.slug,
          title: existingPost.title,
          status: existingPost.status,
          angle_index: input.angle_index,
          existing: true,
        });
      }

      await serviceSupabase
        .from('blog_research_runs')
        .update({
          status: 'generating',
          selected_angle_index: input.angle_index,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', run.id);

      const approvedNotes = [run.notes, input.notes?.trim()].filter(Boolean).join('\n\n') || '(none)';
      const writerInput = `SELECTED ANGLE
${JSON.stringify(angle, null, 2)}

RESEARCH FINDINGS
${JSON.stringify(packet.findings, null, 2)}

AUDIENCE LANGUAGE
${JSON.stringify(packet.audience_language, null, 2)}

APPROVED SOURCES
${JSON.stringify(packet.sources, null, 2)}

PEDRO NOTES
${approvedNotes}

Write the article now. Use only these facts and sources. Return the required JSON only.`;

      const writerResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 6500,
        system: BLOG_WRITER_SYSTEM,
        messages: [{ role: 'user', content: writerInput }],
      });

      const writerRaw = extractText(writerResponse.content as unknown[]);
      let blog = parseJsonObject<GeneratedBlog>(writerRaw);
      if (!blog?.title || !blog.content_md) {
        console.error('Blog writer response was not parseable:', {
          stop_reason: writerResponse.stop_reason,
          raw_length: writerRaw.length,
        });
        const retryResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 7000,
          system: BLOG_WRITER_SYSTEM,
          messages: [{
            role: 'user',
            content: `${writerInput}\n\nYour previous response could not be parsed. Try once more. Return one strict JSON object with correctly escaped Markdown in content_md and no text outside the object.`,
          }],
        });
        blog = parseJsonObject<GeneratedBlog>(
          extractText(retryResponse.content as unknown[]),
        );
        if (!blog?.title || !blog.content_md) {
          throw new Error('The writer did not return a valid article after retrying.');
        }
      }

      let auditIssues = auditBlog(blog.content_md);
      if (auditIssues.length > 0) {
        const revisionResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 6500,
          system: BLOG_WRITER_SYSTEM,
          messages: [{
            role: 'user',
            content: `${writerInput}\n\nFIRST DRAFT\n${JSON.stringify(blog)}\n\nEDITORIAL AUDIT\n${auditIssues.map((issue) => `- ${issue}`).join('\n')}\n\nRevise once. Preserve supported facts and links. Return the complete required JSON.`,
          }],
        });
        const revised = parseJsonObject<GeneratedBlog>(
          extractText(revisionResponse.content as unknown[]),
        );
        if (revised?.title && revised.content_md) blog = revised;
        auditIssues = auditBlog(blog.content_md);
      }

      const sourceIntegrityResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 6500,
        system: BLOG_QC_SYSTEM,
        messages: [{
          role: 'user',
          content: `RESEARCH PACKET
${JSON.stringify(packet, null, 2)}

APPROVED PEDRO NOTES
${approvedNotes}

ARTICLE
${blog.content_md}

Run the final source-integrity edit. Return the required JSON only.`,
        }],
      });
      const sourceIntegrity = parseJsonObject<BlogQcResult>(
        extractText(sourceIntegrityResponse.content as unknown[]),
      );
      if (!sourceIntegrity?.content_md) {
        throw new Error('The final source-integrity check did not return a usable article.');
      }
      blog.title = removeDashPunctuation(blog.title);
      blog.meta_description = removeDashPunctuation(blog.meta_description ?? '');
      blog.content_md = removeDashPunctuation(sourceIntegrity.content_md);
      auditIssues = auditBlog(blog.content_md);

      const baseSlug = slugifyBlogTitle(blog.slug || blog.title);
      const finalSlug = `${baseSlug || 'cerebro-article'}-${Date.now().toString(36)}`;
      const qcReport = {
        deterministic_issues: auditIssues,
        source_integrity_fixes: Array.isArray(sourceIntegrity.issues)
          ? sourceIntegrity.issues
              .map((issue) => removeDashPunctuation(String(issue)))
              .slice(0, 20)
          : [],
        model_check: blog.quality_check ?? {},
        checked_at: new Date().toISOString(),
      };

      const { data: post, error: insertError } = await serviceSupabase
        .from('blog_posts')
        .insert({
          title: blog.title.slice(0, 160),
          slug: finalSlug,
          topic: run.seed_topic ?? angle.working_title,
          notes: approvedNotes === '(none)' ? null : approvedNotes,
          content_md: blog.content_md,
          meta_description: blog.meta_description?.slice(0, 160) ?? null,
          status: 'research_draft',
          published_at: null,
          research_context: JSON.stringify(packet, null, 2),
          research_run_id: run.id,
          research_angle_index: input.angle_index,
          qc_report: qcReport,
          author: 'Pedro Avila',
        })
        .select('id, slug, title, status')
        .single<{ id: string; slug: string; title: string; status: string }>();

      if (insertError || !post) {
        console.error('Blog draft insert error:', insertError);
        throw new Error('The article was written but could not be saved.');
      }

      const { count: generatedAngleCount } = await serviceSupabase
        .from('blog_posts')
        .select('id', { count: 'exact', head: true })
        .eq('research_run_id', run.id)
        .not('research_angle_index', 'is', null);
      const completedAllAngles = (generatedAngleCount ?? 1) >= packet.angles.length;

      await serviceSupabase
        .from('blog_research_runs')
        .update({
          status: completedAllAngles ? 'drafted' : 'ready',
          selected_angle_index: input.angle_index,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', run.id);

      return respond({
        post_id: post.id,
        slug: post.slug,
        title: post.title,
        status: post.status,
        angle_index: input.angle_index,
        remaining_angles: Math.max(packet.angles.length - (generatedAngleCount ?? 1), 0),
        qc_report: qcReport,
      });
    }

    return respond({ error: 'Unknown action.' }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('research-and-draft error:', err);
    if (activeRunId && serviceSupabase) {
      await serviceSupabase
        .from('blog_research_runs')
        .update({
          status: activeAction === 'generate' ? 'ready' : 'failed',
          error: message.slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeRunId);
    }
    return respond({ error: message || 'Internal server error' }, 500);
  }
});
