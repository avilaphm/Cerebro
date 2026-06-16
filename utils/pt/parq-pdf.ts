import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { PT_BOOKING_TIMEZONE } from './bookings';

export interface ParqPdfAnswer {
  label: string;
  text: string;
  answer: 'yes' | 'no';
}

export interface ParqPdfInput {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  email: string;
  consentText: string;
  answers: ParqPdfAnswer[];
  otherMedicalNote?: string;
  signatureDataUrl?: string;
  appointmentStartAt?: string;
  coachNotes?: string;
  submittedAt: string;
}

const MARGIN = 56;
const PAGE_WIDTH = 595.28; // A4 portrait
const PAGE_HEIGHT = 841.89;
const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.42, 0.42, 0.42);
const FLAG = rgb(0.72, 0.45, 0.06);
const LINE = rgb(0.85, 0.85, 0.85);

function formatDateTime(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-AU', {
    timeZone: PT_BOOKING_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDob(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
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

export async function buildParqPdf(input: ParqPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const contentWidth = PAGE_WIDTH - MARGIN * 2;
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawText = (
    text: string,
    options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number; x?: number } = {},
  ) => {
    const useFont = options.font ?? font;
    const size = options.size ?? 10;
    const color = options.color ?? INK;
    const x = options.x ?? MARGIN;
    const lines = wrapText(text, useFont, size, MARGIN + contentWidth - x);
    for (const line of lines) {
      ensureSpace(size + 4);
      (page as PDFPage).drawText(line, { x, y: y - size, font: useFont, size, color });
      y -= size + 4;
    }
    if (options.gap) y -= options.gap;
  };

  const divider = () => {
    ensureSpace(12);
    (page as PDFPage).drawLine({
      start: { x: MARGIN, y: y - 4 },
      end: { x: MARGIN + contentWidth, y: y - 4 },
      thickness: 0.75,
      color: LINE,
    });
    y -= 14;
  };

  // Header
  drawText('PEDRO AVILA COACHING', { font: bold, size: 9, color: MUTED, gap: 2 });
  drawText('Physical Activity Readiness Questionnaire (PAR-Q)', { font: bold, size: 18, gap: 6 });

  const name = `${input.firstName} ${input.lastName}`.trim();
  drawText(`Name: ${name}`, { size: 11, gap: 1 });
  const dob = formatDob(input.dateOfBirth);
  if (dob) drawText(`Date of birth: ${dob}`, { size: 11, color: MUTED, gap: 1 });
  drawText(`Email: ${input.email}`, { size: 11, color: MUTED, gap: 1 });
  const booked = formatDateTime(input.appointmentStartAt);
  if (booked) drawText(`Movement assessment booked: ${booked}`, { size: 11, color: MUTED, gap: 1 });
  const submitted = formatDateTime(input.submittedAt);
  if (submitted) drawText(`Submitted: ${submitted}`, { size: 11, color: MUTED, gap: 6 });

  const medicalFlag = input.answers.some((answer) => answer.answer === 'yes');
  drawText(medicalFlag ? 'PAR-Q outcome: Medical flag present — review before training.' : 'PAR-Q outcome: All answers No.', {
    font: bold,
    size: 11,
    color: medicalFlag ? FLAG : INK,
    gap: 8,
  });
  divider();

  // Questions
  input.answers.forEach((answer, index) => {
    ensureSpace(40);
    drawText(`${index + 1}. ${answer.label}`, { font: bold, size: 11, gap: 1 });
    drawText(answer.text, { size: 10, color: MUTED, gap: 1 });
    drawText(`Answer: ${answer.answer.toUpperCase()}`, {
      font: bold,
      size: 10,
      color: answer.answer === 'yes' ? FLAG : INK,
      gap: 8,
    });
  });

  if (input.otherMedicalNote) {
    divider();
    drawText('Other medical reason (to discuss in person)', { font: bold, size: 11, gap: 2 });
    drawText(input.otherMedicalNote, { size: 10, color: MUTED, gap: 6 });
  }

  if (input.coachNotes) {
    divider();
    drawText('Client note', { font: bold, size: 11, gap: 2 });
    drawText(input.coachNotes, { size: 10, color: MUTED, gap: 6 });
  }

  divider();
  drawText('Consent', { font: bold, size: 11, gap: 2 });
  drawText(input.consentText, { size: 9, color: MUTED, gap: 10 });

  // Signature
  ensureSpace(120);
  drawText('Client signature', { font: bold, size: 11, gap: 6 });
  if (input.signatureDataUrl?.startsWith('data:image/png;base64,')) {
    try {
      const base64 = input.signatureDataUrl.split(',')[1] ?? '';
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const png = await doc.embedPng(bytes);
      const maxW = 220;
      const scale = Math.min(maxW / png.width, 80 / png.height, 1);
      const w = png.width * scale;
      const h = png.height * scale;
      ensureSpace(h + 8);
      (page as PDFPage).drawImage(png, { x: MARGIN, y: y - h, width: w, height: h });
      y -= h + 8;
    } catch {
      drawText('(signature on file)', { size: 9, color: MUTED });
    }
  }
  (page as PDFPage).drawLine({
    start: { x: MARGIN, y: y - 2 },
    end: { x: MARGIN + 240, y: y - 2 },
    thickness: 0.75,
    color: LINE,
  });
  y -= 12;
  drawText(name, { size: 10, color: MUTED });

  return doc.save();
}
