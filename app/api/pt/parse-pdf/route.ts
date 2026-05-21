import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

type PdfTextItem = { str?: string };

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    const buffer = await file.arrayBuffer();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const document = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
    }).promise;

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
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
