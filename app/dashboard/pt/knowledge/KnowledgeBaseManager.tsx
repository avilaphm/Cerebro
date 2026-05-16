'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface BrainMessage {
  role: 'user' | 'assistant';
  content: string;
}

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

  // Voice recording state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');

  // PT Brain chat state
  const [brainMessages, setBrainMessages] = useState<BrainMessage[]>([]);
  const [brainQuery, setBrainQuery] = useState('');
  const [brainLoading, setBrainLoading] = useState(false);
  const brainBottomRef = useRef<HTMLDivElement>(null);

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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
      setVoiceStatus('Recording... click Stop when done.');
    } catch {
      setVoiceStatus('Microphone access denied.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    void processVoiceNote();
  };

  const processVoiceNote = async () => {
    setTranscribing(true);
    setVoiceStatus('Transcribing...');

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });

    const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    if (blob.size < 1000) {
      setVoiceStatus('Recording too short — try again.');
      setTranscribing(false);
      return;
    }

    const { error: invokeError, data: invokeData } = await supabase.functions.invoke('ingest-knowledge-document', {
      body: {
        voice_audio_base64: await blobToBase64(blob),
        voice_mime_type: 'audio/webm',
        title: `Voice note — ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      },
    });

    if (invokeError) {
      setVoiceStatus(`Failed: ${invokeError.message}`);
      setTranscribing(false);
      return;
    }

    const result = invokeData as { chunk_count?: number; document_id?: string } | null;
    setVoiceStatus(`Done — ${result?.chunk_count ?? 0} chunks indexed.`);
    setTranscribing(false);
    router.refresh();
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const askBrain = async () => {
    if (!brainQuery.trim() || brainLoading) return;
    const q = brainQuery.trim();
    setBrainQuery('');
    setBrainMessages((prev) => [...prev, { role: 'user', content: q }]);
    setBrainLoading(true);

    const { data, error } = await supabase.functions.invoke('query-knowledge-brain', {
      body: { query: q, history: brainMessages.slice(-10) },
    });

    const answer = error
      ? 'Failed to get a response. Check the knowledge base has indexed content.'
      : ((data as { answer?: string } | null)?.answer ?? 'No response.');

    setBrainMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    setBrainLoading(false);
    setTimeout(() => brainBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
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
    <div className="space-y-10">
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

      {/* Voice brain dump */}
      <div className="border border-black/10 p-5 space-y-4">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Voice brain dump</p>
          <p className="text-xs text-black/40 mt-1">Record your coaching thoughts, frameworks, and methods. Transcribed and indexed automatically.</p>
        </div>
        <div className="flex items-center gap-4">
          {!recording ? (
            <button
              onClick={() => void startRecording()}
              disabled={transcribing}
              className="flex items-center gap-2 border border-black px-5 py-2.5 text-sm disabled:opacity-30 hover:bg-black hover:text-white transition-colors"
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
              Start recording
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 border border-red-500 bg-red-500 text-white px-5 py-2.5 text-sm hover:bg-red-600 transition-colors"
            >
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-white" />
              Stop recording
            </button>
          )}
          {voiceStatus && (
            <p className="text-xs text-black/50">{voiceStatus}</p>
          )}
        </div>
      </div>

      {/* PT Brain test chat */}
      <div className="border border-black/10 p-5 space-y-4">
        <div>
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-black/35">Test your PT brain</p>
          <p className="text-xs text-black/40 mt-1">Ask questions to verify the brain knows what you uploaded. Answers come from your indexed knowledge base only.</p>
        </div>

        {brainMessages.length > 0 && (
          <div className="space-y-2 max-h-72 overflow-y-auto border border-black/8 px-4 py-3 bg-[#fafaf8]">
            {brainMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 text-sm rounded-xl ${
                  msg.role === 'user'
                    ? 'bg-black text-white rounded-br-none'
                    : 'bg-white border border-black/10 text-black rounded-bl-none'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {brainLoading && (
              <div className="flex justify-start">
                <div className="px-3 py-2 text-sm text-black/30 bg-white border border-black/10 rounded-xl rounded-bl-none">
                  Searching knowledge base...
                </div>
              </div>
            )}
            <div ref={brainBottomRef} />
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={brainQuery}
            onChange={(e) => setBrainQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void askBrain(); }}
            placeholder="e.g. What does Zatsiorsky say about 1RM testing frequency?"
            className="flex-1 border border-black/10 px-3 py-2.5 text-sm outline-none focus:border-black/40"
          />
          <button
            onClick={() => void askBrain()}
            disabled={!brainQuery.trim() || brainLoading}
            className="border border-black bg-black text-white px-5 py-2.5 text-sm disabled:opacity-30 hover:bg-white hover:text-black transition-colors"
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
