'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface KnowledgeDoc {
  id: string;
  title: string;
  description: string | null;
  file_type: string | null;
  chunk_count: number;
  created_at: string;
}

const ACCEPTED_TYPES = '.pdf,.txt,.md,.doc,.docx';
const ACCEPTED_MIME = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export default function KnowledgeBaseManager({ documents: initial }: { documents: KnowledgeDoc[] }) {
  const supabase = createClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<KnowledgeDoc[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (file && !title) {
      setTitle(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '));
    }
  };

  const upload = async () => {
    if (!selectedFile || !title.trim()) return;
    if (!ACCEPTED_MIME.includes(selectedFile.type)) {
      setUploadStatus('Unsupported file type. Use PDF, TXT, MD, or DOCX.');
      return;
    }

    setUploading(true);
    setUploadStatus('Uploading file…');

    const ext = selectedFile.name.split('.').pop() ?? 'bin';
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: storageError } = await supabase.storage
      .from('pt-knowledge-docs')
      .upload(path, selectedFile, { contentType: selectedFile.type });

    if (storageError) {
      setUploadStatus(`Upload failed: ${storageError.message}`);
      setUploading(false);
      return;
    }

    setUploadStatus('Creating document record…');

    const { data: doc, error: insertError } = await supabase
      .from('pt_knowledge_documents')
      .insert({
        title: title.trim(),
        description: description.trim() || null,
        file_path: path,
        file_type: selectedFile.type,
        source: 'upload',
      })
      .select('id, title, description, file_type, chunk_count, created_at')
      .single();

    if (insertError || !doc) {
      setUploadStatus(`Record creation failed: ${insertError?.message ?? 'unknown error'}`);
      setUploading(false);
      return;
    }

    setUploadStatus('Processing and indexing document…');

    const { error: ingestError } = await supabase.functions.invoke('ingest-knowledge-document', {
      body: { document_id: doc.id },
    });

    if (ingestError) {
      setUploadStatus(`Indexing failed: ${ingestError.message}. Document saved but not searchable yet.`);
    } else {
      const { data: updated } = await supabase
        .from('pt_knowledge_documents')
        .select('chunk_count')
        .eq('id', doc.id)
        .single();

      const chunk_count = (updated as { chunk_count: number } | null)?.chunk_count ?? 0;
      setDocs((cur) => [{ ...doc, chunk_count }, ...cur]);
      setUploadStatus(`Done — ${chunk_count} chunks indexed and ready for generation.`);
    }

    setTitle('');
    setDescription('');
    setSelectedFile(null);
    if (fileRef.current) fileRef.current.value = '';
    setUploading(false);
    router.refresh();
  };

  const deleteDoc = async (id: string, filePath?: string) => {
    setDeletingId(id);

    await supabase.from('pt_knowledge_documents').delete().eq('id', id);

    if (filePath) {
      await supabase.storage.from('pt-knowledge-docs').remove([filePath]);
    }

    setDocs((cur) => cur.filter((d) => d.id !== id));
    setDeletingId(null);
  };

  const fileTypeBadge = (type: string | null) => {
    if (!type) return 'FILE';
    if (type.includes('pdf')) return 'PDF';
    if (type.includes('markdown') || type.includes('md')) return 'MD';
    if (type.includes('word') || type.includes('doc')) return 'DOCX';
    if (type.includes('text')) return 'TXT';
    return 'FILE';
  };

  return (
    <div className="space-y-8">
      {/* Upload form */}
      <div className="border border-black/10 p-5 space-y-4">
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Add document</p>

        <div>
          <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Science and Practice of Strength Training"
            className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
          />
        </div>

        <div>
          <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">
            Description (optional)
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Zatsiorsky & Kraemer — strength periodisation principles"
            className="w-full border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
          />
        </div>

        <div>
          <label className="block text-[0.6rem] uppercase tracking-[0.15em] text-black/35 mb-1.5">
            File (PDF, TXT, MD, DOCX — max 50 MB)
          </label>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={handleFileChange}
            className="block w-full text-sm text-black/50 file:mr-4 file:border file:border-black/15 file:bg-transparent file:px-4 file:py-2 file:text-xs file:text-black/60 hover:file:border-black/30"
          />
          {selectedFile && (
            <p className="mt-1 text-xs text-black/35">
              {selectedFile.name} — {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
            </p>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => void upload()}
            disabled={uploading || !selectedFile || !title.trim()}
            className="border border-black bg-black text-white px-6 py-2.5 text-sm disabled:opacity-30 hover:bg-white hover:text-black transition-colors"
          >
            {uploading ? 'Processing…' : 'Upload & index'}
          </button>
          {uploadStatus && (
            <p className="text-xs text-black/50">{uploadStatus}</p>
          )}
        </div>
      </div>

      {/* Document list */}
      <div>
        <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35 mb-4">
          Indexed documents ({docs.length})
        </p>

        {docs.length === 0 ? (
          <p className="text-sm text-black/30 border border-black/8 border-dashed px-5 py-8 text-center">
            No documents yet. Upload a PDF or text file above.
          </p>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-col gap-2 border border-black/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[0.55rem] uppercase tracking-[0.1em] border border-black/15 px-1.5 py-0.5 text-black/40">
                      {fileTypeBadge(doc.file_type)}
                    </span>
                    <p className="font-medium text-sm truncate">{doc.title}</p>
                  </div>
                  {doc.description && (
                    <p className="text-xs text-black/40 mt-0.5 truncate">{doc.description}</p>
                  )}
                  <p className="text-[0.6rem] text-black/25 mt-1">
                    {doc.chunk_count > 0
                      ? `${doc.chunk_count} chunks indexed`
                      : 'Not yet indexed'}{' '}
                    · {new Date(doc.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <button
                  onClick={() => void deleteDoc(doc.id)}
                  disabled={deletingId === doc.id}
                  className="shrink-0 text-xs text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
                >
                  {deletingId === doc.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border border-black/8 bg-[#fafaf8] px-4 py-4 text-xs text-black/40 space-y-1">
        <p className="font-medium text-black/55">How it works</p>
        <p>Every uploaded document is chunked and embedded. When you generate a programme, the AI automatically searches your knowledge base for relevant content and combines it with live web research to inform exercise selection and progression — while always keeping the 5-phase programme structure intact.</p>
      </div>
    </div>
  );
}
