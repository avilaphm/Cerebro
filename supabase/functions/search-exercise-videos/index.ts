import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface YouTubeSearchItem {
  id: { videoId: string };
  snippet: { title: string };
}

interface YouTubeSearchResponse {
  items: YouTubeSearchItem[];
  error?: { message: string };
}

async function searchYouTube(
  query: string,
  apiKey: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    part: 'id,snippet',
    q: query,
    type: 'video',
    videoDuration: 'short',
    maxResults: '5',
    key: apiKey,
    relevanceLanguage: 'en',
    safeSearch: 'none',
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  const data: YouTubeSearchResponse = await res.json();

  if (data.error || !data.items?.length) return null;

  // Prefer Shorts if available, otherwise take first result
  for (const item of data.items) {
    const vid = item.id.videoId;
    const title = item.snippet.title.toLowerCase();
    if (title.includes('short') || title.includes('how to') || title.includes('tutorial') || title.includes('exercise')) {
      return `https://www.youtube.com/watch?v=${vid}`;
    }
  }

  return `https://www.youtube.com/watch?v=${data.items[0].id.videoId}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const internalSecret = Deno.env.get('INTERNAL_SECRET');
  const authHeader = req.headers.get('Authorization');

  // Allow both internal secret and client auth (for per-exercise "Find video" button)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const youtubeKey = Deno.env.get('YOUTUBE_API_KEY');

  if (!youtubeKey) return json({ error: 'YOUTUBE_API_KEY secret not configured' }, 500);

  // Auth: service_role JWT (batch runs) OR Pedro's user JWT (dashboard Find Video button)
  function jwtPayload(jwt: string): Record<string, unknown> {
    try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
    catch { return {}; }
  }
  const token = (authHeader ?? '').replace('Bearer ', '');
  const payload = jwtPayload(token);
  let isAdmin = payload.role === 'service_role';

  if (!isAdmin) {
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader ?? '' } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    isAdmin = user?.email === 'avila.phm@gmail.com' || user?.email === 'pedro@cerebroai.au';
  }

  if (!isAdmin) return json({ error: 'Unauthorized' }, 401);

  const adminClient = createClient(supabaseUrl, supabaseKey);

  let body: { exercise_ids?: string[] } = {};
  try { body = await req.json(); } catch { /* batch mode */ }

  // Fetch exercises to process
  let query = adminClient.from('pt_exercises').select('id, name');
  if (body.exercise_ids?.length) {
    query = query.in('id', body.exercise_ids);
  } else {
    query = query.is('video_url', null);
  }

  const { data: exercises, error: fetchError } = await query;
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!exercises?.length) return json({ populated: 0, missing: [], message: 'No exercises to process' });

  let populated = 0;
  const missing: string[] = [];

  for (const ex of exercises) {
    try {
      const videoUrl = await searchYouTube(`${ex.name} exercise tutorial`, youtubeKey);

      if (videoUrl) {
        await adminClient.from('pt_exercises').update({ video_url: videoUrl }).eq('id', ex.id);
        populated++;
      } else {
        missing.push(ex.name);
      }
    } catch {
      missing.push(ex.name);
    }

    // Throttle: YouTube free tier allows ~10k units/day; search costs 100 units each
    await new Promise((r) => setTimeout(r, 200));
  }

  return json({ populated, missing });
});
