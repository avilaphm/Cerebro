import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { safeProgramme, countProgrammeWeeks } from '@/utils/pt/programme';
import type { PTProgramTemplate } from '@/utils/pt/types';

export async function POST(req: NextRequest) {
  const { template_id, client_id } = (await req.json()) as { template_id?: string; client_id?: string };
  if (!template_id || !client_id) {
    return NextResponse.json({ error: 'Missing template_id or client_id' }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: raw, error: tErr } = await supabase
    .from('pt_program_templates')
    .select('*')
    .eq('id', template_id)
    .single();

  if (tErr || !raw) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const template = raw as PTProgramTemplate;
  const programme = safeProgramme(template.programme);

  const { data: assignment, error: aErr } = await supabase
    .from('pt_program_assignments')
    .insert({
      client_id,
      template_id,
      name: template.name,
      goal: template.goal,
      duration_weeks: countProgrammeWeeks(programme),
      phase_count: programme.phases.length,
      status: 'active',
      programme,
    })
    .select('id')
    .single();

  if (aErr || !assignment) {
    return NextResponse.json({ error: 'Failed to create assignment' }, { status: 500 });
  }

  await supabase.from('pt_events').insert({
    client_id,
    event_type: 'programme_assigned',
    metadata: { template_id, template_name: template.name },
  });

  return NextResponse.json({ assignment_id: (assignment as { id: string }).id });
}
