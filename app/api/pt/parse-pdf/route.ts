import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_PAGES = 60;

type PdfTextItem = { str?: string };

export async function POST(req: NextRequest) {
  try {
    // Require an authenticated user — this endpoint is only used by dashboard uploads.
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File too large (max 15MB).' }, { status: 413 });
    }
    const buffer = await file.arrayBuffer();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Preload the worker module so pdf.js can run in Vercel's serverless runtime
    // without trying to import an unbundled pdf.worker.mjs file at request time.
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
    } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;

    const pageCount = Math.min(document.numPages, MAX_PAGES);
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? (item as PdfTextItem).str ?? '' : ''))
        .join(' ')
        .trim();
      if (pageText) pages.push(pageText);
    }

    await document.destroy();
    const text = pages.join('\n\n').trim();
    if (!text) {
      return NextResponse.json({ error: 'PDF appears to have no readable text (scanned image?).' }, { status: 422 });
    }
    return NextResponse.json({ text: text.slice(0, 100_000) });
  } catch (err) {
    return NextResponse.json(
      { error: `PDF parse failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
