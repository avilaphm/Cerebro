import { NextRequest, NextResponse } from 'next/server';
import { buildMLClientProfilePdf } from '@/utils/pt/ml-client-profile-pdf';
import { isPedroAdminEmail } from '@/utils/pt/access';
import { createAdminClient } from '@/utils/supabase/admin';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'pt-client-docs';

interface RequestBody {
  document_id?: unknown;
}

interface ClientDocumentRow {
  id: string;
  client_id: string;
  title: string;
  content_text: string | null;
  parsed_summary: Record<string, unknown>;
  analysis: Record<string, unknown>;
}

interface ClientRow {
  id: string;
  name: string;
  last_name: string | null;
}

interface NoteRow {
  id: string;
  context: Record<string, unknown> | null;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'admin' && !isPedroAdminEmail(user.email)) {
      return NextResponse.json({ error: 'Only Pedro can generate this PDF.' }, { status: 403 });
    }

    const body = (await req.json()) as RequestBody;
    if (typeof body.document_id !== 'string' || !body.document_id) {
      return NextResponse.json({ error: 'document_id required.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: document, error: documentError } = await admin
      .from('pt_client_documents')
      .select('id, client_id, title, content_text, parsed_summary, analysis')
      .eq('id', body.document_id)
      .eq('document_type', 'profile')
      .single();

    if (documentError || !document) {
      return NextResponse.json({ error: 'Generated profile document not found.' }, { status: 404 });
    }

    const docRow = document as ClientDocumentRow;
    const markdown = docRow.content_text?.trim();
    if (!markdown) {
      return NextResponse.json({ error: 'Generated profile document has no text to export.' }, { status: 422 });
    }

    const { data: client, error: clientError } = await admin
      .from('pt_clients')
      .select('id, name, last_name')
      .eq('id', docRow.client_id)
      .single();

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    }

    const clientRow = client as ClientRow;
    const assessmentNoteId = findAssessmentNoteId(docRow);
    const assessmentNote = assessmentNoteId
      ? await loadAssessmentNote(admin, assessmentNoteId)
      : null;

    const generatedAt = new Date().toISOString();
    const pdfBytes = await buildMLClientProfilePdf({
      title: docRow.title,
      clientName: [clientRow.name, clientRow.last_name].filter(Boolean).join(' '),
      markdown,
      generatedAt,
      videoNotesAppendix: assessmentNote ? buildVideoNotesAppendix(assessmentNote) : undefined,
    });

    const storagePath = `${docRow.client_id}/ml-client-intelligence/${Date.now()}-${slugify(docRow.title)}.pdf`;
    const upload = await admin.storage
      .from(BUCKET)
      .upload(storagePath, Buffer.from(pdfBytes), { contentType: 'application/pdf', upsert: true });

    if (upload.error) throw upload.error;

    const nextAnalysis = {
      ...asRecord(docRow.analysis),
      pdf_export: {
        storage_path: storagePath,
        generated_at: generatedAt,
        assessment_note_id: assessmentNoteId,
      },
    };

    await admin
      .from('pt_client_documents')
      .update({
        storage_path: storagePath,
        analysis: nextAnalysis,
        status: 'analysed',
        uploaded_by: user.id,
        updated_at: generatedAt,
      })
      .eq('id', docRow.id);

    await admin.from('pt_events').insert({
      client_id: docRow.client_id,
      event_type: 'ml_client_intelligence_pdf_generated',
      metadata: {
        source: 'ml_client_intelligence_pdf',
        document_id: docRow.id,
        storage_path: storagePath,
        assessment_note_id: assessmentNoteId,
      },
    });

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 3600);

    return NextResponse.json({
      ok: true,
      document_id: docRow.id,
      storage_path: storagePath,
      signed_url: signed?.signedUrl ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not generate M & L PDF.' },
      { status: 500 },
    );
  }
}

function findAssessmentNoteId(document: ClientDocumentRow): string | null {
  const parsed = asRecord(document.parsed_summary);
  const analysis = asRecord(document.analysis);
  const parsedEvidence = asRecord(parsed.evidence);
  return stringValue(parsed.assessment_note_id)
    ?? stringValue(analysis.assessment_note_id)
    ?? stringValue(parsedEvidence.assessment_note_id);
}

async function loadAssessmentNote(
  admin: ReturnType<typeof createAdminClient>,
  noteId: string,
): Promise<NoteRow | null> {
  const { data } = await admin
    .from('pt_client_notes')
    .select('id, context')
    .eq('id', noteId)
    .maybeSingle();
  return data as NoteRow | null;
}

function buildVideoNotesAppendix(note: NoteRow): string {
  const context = asRecord(note.context);
  const summary = asRecord(context.movement_assessment_summary);
  const movements = Array.isArray(summary.movements) ? summary.movements : [];
  const lines: string[] = [];

  for (const item of movements) {
    const movement = asRecord(item);
    const title = stringValue(movement.title) ?? 'Movement';
    const notes = stringValue(movement.notes);
    const hasVideo = Boolean(stringValue(movement.video_path));
    if (!notes && !hasVideo) continue;
    lines.push(`### ${title}`);
    lines.push(`- Video recorded: ${hasVideo ? 'Yes' : 'No'}`);
    if (notes) lines.push(`- Pedro video note: ${notes}`);
    lines.push('');
  }

  return lines.join('\n').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'ml-client-intelligence';
}
