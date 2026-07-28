'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface ResearchSource {
  title: string;
  url: string;
  publisher: string;
  published_at: string | null;
  source_type: 'primary' | 'industry' | 'public_discussion';
  key_fact: string;
}

interface ResearchAngle {
  id: string;
  working_title: string;
  target_reader: string;
  opening_scene: string;
  central_tension: string;
  belief_shift: string;
  real_case: string;
  practical_takeaway: string;
  source_urls: string[];
}

interface ResearchRun {
  id: string;
  seed_topic: string | null;
  sector: string;
  status: 'researching' | 'ready' | 'generating' | 'drafted' | 'failed';
  findings: string[];
  audience_language: string[];
  angles: ResearchAngle[];
  sources: ResearchSource[];
}

interface ResearchWorkspaceProps {
  onDraftCreated: (postId: string) => Promise<void> | void;
}

function sourceLabel(source: ResearchSource) {
  return [source.publisher, source.published_at].filter(Boolean).join(' / ');
}

async function invokeErrorMessage(
  data: { error?: string } | null,
  invokeError: unknown,
  fallback: string,
) {
  if (data?.error) return data.error;

  const response = (invokeError as { context?: Response } | null)?.context;
  if (response) {
    if (response.status === 401) {
      return 'Your login session expired. Refresh this page and try again.';
    }
    try {
      const body = await response.clone().json() as {
        error?: string;
        message?: string;
        msg?: string;
      };
      if (body.error || body.message || body.msg) {
        return body.error ?? body.message ?? body.msg ?? fallback;
      }
    } catch {
      // Fall through to the SDK message when the response body is unavailable.
    }
  }

  return (invokeError as { message?: string } | null)?.message ?? fallback;
}

export default function ResearchWorkspace({ onDraftCreated }: ResearchWorkspaceProps) {
  const supabase = useMemo(() => createClient(), []);
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [researching, setResearching] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [showSources, setShowSources] = useState(false);

  const loadLatestReadyRun = useCallback(async () => {
    const { data } = await supabase
      .from('blog_research_runs')
      .select('id, seed_topic, sector, status, findings, audience_language, angles, sources')
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<ResearchRun>();

    if (data) {
      setRun(data);
      setTopic(data.seed_topic ?? '');
    }
  }, [supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLatestReadyRun();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLatestReadyRun]);

  async function startResearch() {
    if (researching) return;
    setResearching(true);
    setError('');
    setRun(null);
    setShowSources(false);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('research-and-draft', {
        body: {
          action: 'research',
          topic: topic.trim() || undefined,
          notes: notes.trim() || undefined,
        },
      });

      if (invokeError || data?.error || !data?.run) {
        setError(await invokeErrorMessage(
          data,
          invokeError,
          'Research failed. Try a more specific topic.',
        ));
        return;
      }
      setRun(data.run as ResearchRun);
    } catch (researchError) {
      setError(researchError instanceof Error ? researchError.message : 'Research failed.');
    } finally {
      setResearching(false);
    }
  }

  async function generateDraft(angleIndex: number) {
    if (!run || generatingIndex !== null) return;
    setGeneratingIndex(angleIndex);
    setError('');

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('research-and-draft', {
        body: {
          action: 'generate',
          run_id: run.id,
          angle_index: angleIndex,
        },
      });

      if (invokeError || data?.error || !data?.post_id) {
        setError(await invokeErrorMessage(
          data,
          invokeError,
          'The draft could not be generated.',
        ));
        return;
      }

      await onDraftCreated(data.post_id);
      setRun(null);
      setTopic('');
      setNotes('');
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'The draft could not be generated.');
    } finally {
      setGeneratingIndex(null);
    }
  }

  return (
    <section id="blog-research" className="mb-10 border border-black/10 rounded-xl overflow-hidden bg-white">
      <div className="p-5 md:p-6">
        <div className="max-w-2xl">
          <p className="text-xs font-medium text-black/40 mb-2">Construction-first research</p>
          <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-black">
            Find the story before writing the article.
          </h2>
          <p className="text-sm leading-relaxed text-black/50 mt-2">
            Cerebro searches current construction, infrastructure and advisory sources, then gives you three real angles to choose from.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)] gap-4 mt-6">
          <div>
            <label htmlFor="blog-topic" className="block text-xs font-medium text-black/60 mb-2">
              Topic or operating problem
            </label>
            <input
              id="blog-topic"
              type="text"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Leave blank to discover the strongest current angle"
              disabled={researching || generatingIndex !== null}
              className="w-full border border-black/20 rounded-lg px-3.5 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50"
            />
          </div>
          <div>
            <label htmlFor="blog-notes" className="block text-xs font-medium text-black/60 mb-2">
              Pedro notes <span className="font-normal text-black/35">(optional)</span>
            </label>
            <input
              id="blog-notes"
              type="text"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="A take, example or boundary"
              disabled={researching || generatingIndex !== null}
              className="w-full border border-black/20 rounded-lg px-3.5 py-3 text-sm text-black placeholder:text-black/35 focus:outline-none focus:ring-1 focus:ring-black disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button
            type="button"
            onClick={startResearch}
            disabled={researching || generatingIndex !== null}
            className="bg-black text-white text-sm px-5 py-2.5 rounded-lg hover:opacity-80 active:translate-y-px transition disabled:opacity-35 whitespace-nowrap"
          >
            {researching ? 'Researching current sources...' : run ? 'Run new research' : 'Research three angles'}
          </button>
          {run && (
            <button
              type="button"
              onClick={() => setRun(null)}
              disabled={generatingIndex !== null}
              className="text-sm text-black/45 hover:text-black transition-colors disabled:opacity-40"
            >
              Clear results
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3">
            {error}
          </p>
        )}

        {researching && (
          <div aria-live="polite" className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-xl border border-black/10 p-4 animate-pulse">
                <div className="h-3 w-24 bg-black/10 rounded mb-4" />
                <div className="h-5 w-4/5 bg-black/10 rounded mb-3" />
                <div className="h-3 w-full bg-black/5 rounded mb-2" />
                <div className="h-3 w-3/4 bg-black/5 rounded" />
              </div>
            ))}
          </div>
        )}
      </div>

      {run && !researching && (
        <div className="border-t border-black/10">
          <div className="px-5 md:px-6 py-4 bg-black/[0.025] flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-black">Choose the angle worth writing.</p>
              <p className="text-xs text-black/45 mt-1">
                One specific reader, one operating constraint, one useful takeaway.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSources((current) => !current)}
              className="text-xs text-black/50 hover:text-black transition-colors text-left md:text-right"
            >
              {showSources ? 'Hide research sources' : `Review ${run.sources.length} research sources`}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3">
            {run.angles.map((angle, index) => (
              <article
                key={angle.id}
                className="p-5 md:p-6 border-b lg:border-b-0 lg:border-r last:border-0 border-black/10 flex flex-col"
              >
                <p className="text-xs text-black/40 mb-3">{angle.target_reader}</p>
                <h3 className="font-display text-lg font-medium text-black leading-snug">
                  {angle.working_title}
                </h3>
                <p className="text-sm leading-relaxed text-black/60 mt-4">
                  {angle.opening_scene}
                </p>
                <dl className="mt-5 space-y-4 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-black/40 mb-1">The tension</dt>
                    <dd className="text-black/65 leading-relaxed">{angle.central_tension}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-black/40 mb-1">Real case</dt>
                    <dd className="text-black/65 leading-relaxed">{angle.real_case}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-black/40 mb-1">Take back to work</dt>
                    <dd className="text-black/65 leading-relaxed">{angle.practical_takeaway}</dd>
                  </div>
                </dl>
                <div className="mt-auto pt-6">
                  <button
                    type="button"
                    onClick={() => generateDraft(index)}
                    disabled={generatingIndex !== null}
                    className="w-full bg-black text-white text-sm px-4 py-2.5 rounded-lg hover:opacity-80 active:translate-y-px transition disabled:opacity-35"
                  >
                    {generatingIndex === index ? 'Writing and checking draft...' : 'Write this article'}
                  </button>
                </div>
              </article>
            ))}
          </div>

          {showSources && (
            <div className="border-t border-black/10 px-5 md:px-6 py-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
                {run.sources.map((source) => (
                  <div key={source.url} className="min-w-0">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-black underline decoration-black/20 underline-offset-4 hover:decoration-black"
                    >
                      {source.title}
                    </a>
                    <p className="text-xs text-black/40 mt-1">{sourceLabel(source)}</p>
                    <p className="text-xs leading-relaxed text-black/55 mt-2">{source.key_fact}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
