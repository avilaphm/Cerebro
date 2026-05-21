import { NextRequest, NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    const buffer = await file.arrayBuffer();
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = result.text.trim();
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
