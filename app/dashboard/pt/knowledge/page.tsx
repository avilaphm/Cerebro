import { createClient } from '@/utils/supabase/server';
import KnowledgeBaseManager from './KnowledgeBaseManager';

export const dynamic = 'force-dynamic';

export default async function KnowledgePage() {
  const supabase = await createClient();

  const { data: documents } = await supabase
    .from('pt_knowledge_documents')
    .select('id, title, description, file_type, chunk_count, created_at')
    .order('created_at', { ascending: false });

  return (
    <div className="max-w-3xl px-5 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mb-8">
        <h1 className="text-xl font-light tracking-tight">Knowledge Base</h1>
        <p className="mt-1 text-sm text-black/40">
          Upload PDFs and documents on programming and nutrition. AI programme generation pulls from these automatically.
        </p>
      </div>
      <KnowledgeBaseManager documents={documents ?? []} />
    </div>
  );
}
