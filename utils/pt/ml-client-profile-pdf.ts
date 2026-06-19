import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export interface MLClientProfilePdfInput {
  title: string;
  clientName: string;
  markdown: string;
  generatedAt: string;
  videoNotesAppendix?: string;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 54;
const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.42, 0.42, 0.42);
const LIGHT = rgb(0.9, 0.9, 0.88);
const FILL = rgb(0.98, 0.98, 0.96);

function normalizeText(value: string) {
  return value
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, ' ')
    .trim();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function markdownLines(markdown: string, appendix?: string) {
  const base = normalizeText(markdown)
    .split('\n')
    .map((line) => line.trimEnd());
  if (!appendix?.trim()) return base;
  return [
    ...base,
    '',
    '## Movement Video Notes Appendix',
    ...normalizeText(appendix).split('\n').map((line) => line.trimEnd()),
  ];
}

export async function buildMLClientProfilePdf(input: MLClientProfilePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const addSizedPage = () => {
    const nextPage = doc.addPage();
    nextPage.setSize(PAGE_WIDTH, PAGE_HEIGHT);
    return nextPage;
  };

  let page = addSizedPage();
  let pageNumber = 1;
  let y = PAGE_HEIGHT - MARGIN;
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  const drawFooter = () => {
    page.drawText(`Page ${pageNumber}`, {
      x: PAGE_WIDTH - MARGIN - 42,
      y: 30,
      font,
      size: 8,
      color: MUTED,
    });
  };

  const newPage = () => {
    drawFooter();
    page = addSizedPage();
    pageNumber += 1;
    y = PAGE_HEIGHT - MARGIN;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) newPage();
  };

  const drawText = (
    text: string,
    options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number; indent?: number; leading?: number } = {},
  ) => {
    const useFont = options.font ?? font;
    const size = options.size ?? 10;
    const leading = options.leading ?? size + 5;
    const color = options.color ?? INK;
    const indent = options.indent ?? 0;
    const lines = wrapText(text, useFont, size, contentWidth - indent);
    for (const line of lines) {
      ensureSpace(leading + 2);
      page.drawText(line, { x: MARGIN + indent, y: y - size, font: useFont, size, color });
      y -= leading;
    }
    if (options.gap) y -= options.gap;
  };

  const divider = () => {
    ensureSpace(12);
    page.drawRectangle({
      x: MARGIN,
      y: y - 4,
      width: contentWidth,
      height: 0.75,
      color: LIGHT,
    });
    y -= 16;
  };

  page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - 160,
    width: PAGE_WIDTH,
    height: 160,
    color: FILL,
  });
  drawText('PEDRO AVILA COACHING', { font: bold, size: 9, color: MUTED, gap: 6 });
  drawText(normalizeText(input.title), { font: bold, size: 20, leading: 25, gap: 8 });
  drawText(`Client: ${normalizeText(input.clientName)}`, { size: 11, color: MUTED, gap: 2 });
  drawText(`Generated: ${formatDateTime(input.generatedAt)}`, { size: 10, color: MUTED, gap: 18 });
  divider();

  for (const rawLine of markdownLines(input.markdown, input.videoNotesAppendix)) {
    const line = rawLine.trim();
    if (!line) {
      y -= 7;
      continue;
    }

    if (line.startsWith('# ')) {
      ensureSpace(48);
      drawText(line.replace(/^#\s+/, ''), { font: bold, size: 18, leading: 23, gap: 8 });
      divider();
      continue;
    }

    if (line.startsWith('## ')) {
      ensureSpace(42);
      y -= 8;
      drawText(line.replace(/^##\s+/, '').toUpperCase(), { font: bold, size: 10, color: MUTED, leading: 14, gap: 6 });
      continue;
    }

    if (line.startsWith('### ')) {
      ensureSpace(28);
      drawText(line.replace(/^###\s+/, ''), { font: bold, size: 12, leading: 17, gap: 3 });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      drawText(`- ${line.replace(/^[-*]\s+/, '')}`, { size: 10, leading: 15, indent: 12, gap: 2 });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      drawText(line, { size: 10, leading: 15, indent: 12, gap: 2 });
      continue;
    }

    if (/^\*\*.+\*\*:/.test(line)) {
      drawText(line.replace(/\*\*/g, ''), { font: bold, size: 10, leading: 15, gap: 2 });
      continue;
    }

    drawText(line.replace(/\*\*/g, ''), { font: line.startsWith('_') ? italic : font, size: 10, leading: 15, gap: 3 });
  }

  drawFooter();
  return doc.save();
}
