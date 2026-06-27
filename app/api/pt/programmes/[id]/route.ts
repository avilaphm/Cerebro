import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { countProgrammeWeeks, safeProgramme } from '@/utils/pt/programme';
import type { PTProgramAssignment } from '@/utils/pt/types';

interface NutritionRowInput {
  id?: string;
  phase_index: number;
  phase_title: string;
  phase_type: string;
  training_context: Record<string, unknown>;
  recommendations: Record<string, unknown>;
  review_status: string;
}

interface SaveProgrammeInput {
  name?: string;
  goal?: string | null;
  status?: PTProgramAssignment['status'];
  programme?: unknown;
  generation_run_id?: string | null;
  validation_summary?: Record<string, unknown>;
  cursor?: {
    changed?: boolean;
    phase_index?: number;
    block_index?: number;
    week?: number;
  };
  nutrition_rows?: NutritionRowInput[];
  highlight_note_id?: string | null;
}

const ALLOWED_STATUSES = new Set<PTProgramAssignment['status']>([
  'draft',
  'active',
  'completed',
  'paused',
  'archived',
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Dashboard session expired. Sign in again and retry.' }, { status: 401 });

  const { id } = await ctx.params;
  const body = await req.json() as SaveProgrammeInput;
  const name = body.name?.trim() ?? '';
  if (!name || !body.programme) {
    return NextResponse.json({ error: 'Programme name and programme data are required.' }, { status: 400 });
  }
  if (body.status && !ALLOWED_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'Invalid programme status.' }, { status: 400 });
  }

  const programme = safeProgramme(body.programme);
  const { data: current, error: currentError } = await supabase
    .from('pt_program_assignments')
    .select('client_id, status, current_phase_index, current_block_index, current_week')
    .eq('id', id)
    .single();

  if (currentError || !current) {
    return NextResponse.json({ error: currentError?.message ?? 'Programme assignment not found.' }, { status: 404 });
  }

  const nextStatus = body.status ?? current.status as PTProgramAssignment['status'];
  const cursor = body.cursor;
  const updatePayload = {
    name,
    goal: body.goal?.trim() || null,
    duration_weeks: countProgrammeWeeks(programme),
    phase_count: programme.phases.length,
    status: nextStatus,
    programme,
    generation_run_id: body.generation_run_id ?? null,
    coach_review_status: 'approved',
    validation_summary: body.validation_summary ?? {},
    ...(cursor?.changed ? {
      current_phase_index: cursor.phase_index,
      current_block_index: cursor.block_index,
      current_week: cursor.week,
    } : {}),
  };

  const { error: updateError } = await supabase
    .from('pt_program_assignments')
    .update(updatePayload)
    .eq('id', id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const warnings: string[] = [];
  if (nextStatus === 'active' && current.status !== 'active') {
    const { error } = await supabase
      .from('pt_program_assignments')
      .update({ status: 'paused' })
      .eq('client_id', current.client_id)
      .eq('status', 'active')
      .neq('id', id);
    if (error) warnings.push(`Programme saved, but another active programme could not be paused: ${error.message}`);
  }

  if ((body.nutrition_rows ?? []).length > 0) {
    const { error } = await supabase.from('pt_phase_nutrition').upsert(
      body.nutrition_rows!.map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        client_id: current.client_id,
        assignment_id: id,
        generation_run_id: body.generation_run_id ?? null,
        phase_index: row.phase_index,
        phase_title: row.phase_title,
        phase_type: row.phase_type,
        training_context: row.training_context,
        recommendations: row.recommendations,
        review_status: row.review_status,
      })),
      { onConflict: 'assignment_id,phase_index' },
    );
    if (error) warnings.push(`Programme saved, but phase nutrition did not sync: ${error.message}`);
  }

  if (body.highlight_note_id) {
    const { error } = await supabase
      .from('pt_client_notes')
      .update({ is_active: false })
      .eq('id', body.highlight_note_id);
    if (error) warnings.push(`Programme saved, but the linked client note stayed open: ${error.message}`);
  }

  if (cursor?.changed) {
    const { error } = await supabase.from('pt_events').insert({
      client_id: current.client_id,
      assignment_id: id,
      event_type: 'programme_position_changed',
      metadata: {
        source: 'programme_edit',
        assignment_name: name,
        from: {
          phase_index: current.current_phase_index,
          block_index: current.current_block_index,
          week: current.current_week,
        },
        to: {
          phase_index: cursor.phase_index,
          phase_title: programme.phases[cursor.phase_index ?? 0]?.title ?? null,
          block_index: cursor.block_index,
          week: cursor.week,
        },
      },
    });
    if (error) warnings.push(`Programme saved, but the position-change event was not recorded: ${error.message}`);
  }

  return NextResponse.json({ ok: true, warnings });
}
