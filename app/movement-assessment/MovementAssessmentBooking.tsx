'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, PenLine, Shirt } from 'lucide-react';
import { PAR_Q_CONSENT_TEXT, PAR_Q_QUESTIONS, type ParQAnswer } from '@/utils/pt/parq';

interface AssessmentSlot {
  start_at: string;
  end_at: string;
  label: string;
  date_label: string;
  time_label: string;
  availability_id: string;
  location: string | null;
}

type Answers = Record<string, ParQAnswer | undefined>;
type Step = 1 | 2 | 3;

export default function MovementAssessmentBooking() {
  const [step, setStep] = useState<Step>(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [email, setEmail] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [otherMedicalNote, setOtherMedicalNote] = useState('');
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState('');
  const [slots, setSlots] = useState<AssessmentSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<AssessmentSlot | null>(null);
  const [coachNotes, setCoachNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmedSlot, setConfirmedSlot] = useState<AssessmentSlot | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const didMountRef = useRef(false);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111111';
  }, []);

  const answeredCount = PAR_Q_QUESTIONS.filter((question) => answers[question.id]).length;
  const medicalFlag = Object.values(answers).includes('yes');
  const dobValid = Boolean(dateOfBirth) && !Number.isNaN(Date.parse(dateOfBirth)) && new Date(dateOfBirth) < new Date();
  const intakeReady = firstName.trim() && lastName.trim() && dobValid && /\S+@\S+\.\S+/.test(email) && answeredCount === PAR_Q_QUESTIONS.length && hasSignature;

  const dates = useMemo(() => {
    const seen = new Set<string>();
    return slots
      .map((slot) => slot.date_label)
      .filter((date) => {
        if (seen.has(date)) return false;
        seen.add(date);
        return true;
      });
  }, [slots]);

  const visibleSlots = useMemo(
    () => slots.filter((slot) => slot.date_label === (selectedDate || dates[0] || '')),
    [dates, selectedDate, slots],
  );

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  // Land at the top of each step so people don't start a new step mid-scroll.
  // Skip the initial mount: scrolling on first hydration can fight a user who
  // has already scrolled down to the questions, making early clicks miss.
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  async function loadSlots() {
    setSlotsLoading(true);
    setSlotsError('');
    try {
      const res = await fetch('/api/pt/movement-assessment/availability', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Could not load times.');
      setSlots(json.slots ?? []);
      setSelectedDate(json.slots?.[0]?.date_label ?? '');
    } catch (error) {
      setSlotsError(error instanceof Error ? error.message : 'Could not load available times.');
    } finally {
      setSlotsLoading(false);
    }
  }

  function continueToCalendar() {
    if (!intakeReady) return;
    // Capture the signature now: the canvas is unmounted once we leave step 1,
    // so it can't be read back at booking time.
    const signature = canvasRef.current?.toDataURL('image/png') ?? '';
    if (signature.startsWith('data:image/png;base64,')) setSignatureDataUrl(signature);
    setStep(2);
    if (slots.length === 0) void loadSlots();
  }

  async function submitBooking() {
    if (!selectedSlot || submitting) return;
    const signature = signatureDataUrl || canvasRef.current?.toDataURL('image/png') || '';
    if (!signature.startsWith('data:image/png;base64,') || !hasSignature) {
      setSubmitError('Please sign the PAR-Q before booking.');
      setStep(1);
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch('/api/pt/movement-assessment/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          date_of_birth: dateOfBirth,
          email,
          answers,
          other_medical_note: answers['other-medical'] === 'yes' ? otherMedicalNote : '',
          signature_data_url: signature,
          coach_notes: coachNotes,
          start_at: selectedSlot.start_at,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Could not complete the booking.');
      setConfirmedSlot(selectedSlot);
      setStep(3);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not complete the booking.');
      await loadSlots();
    } finally {
      setSubmitting(false);
    }
  }

  function setAnswer(questionId: string, value: ParQAnswer) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointerPosition(event);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !lastPointRef.current) return;
    const canvas = event.currentTarget;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const point = pointerPosition(event);
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
    setHasSignature(true);
  }

  function stopDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setSignatureDataUrl('');
  }

  return (
    <main className="min-h-screen bg-[#f7f6f1] px-4 py-5 text-black sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="border border-black/10 bg-white p-5 lg:sticky lg:top-5 lg:h-[calc(100vh-2.5rem)]">
          <p className="text-[0.62rem] uppercase tracking-[0.22em] text-black/40">Pedro Avila Coaching</p>
          <h1 className="mt-3 font-display text-4xl font-light leading-[0.95] sm:text-5xl lg:text-4xl">Movement Assessment</h1>
          <div className="mt-7 space-y-3">
            <ProgressStep active={step === 1} done={step > 1} label="PAR-Q" />
            <ProgressStep active={step === 2} done={step > 2} label="Calendar" />
            <ProgressStep active={step === 3} done={step === 3} label="Booked" />
          </div>
          <div className="mt-8 space-y-3 border-t border-black/10 pt-5 text-sm text-black/60">
            <p className="flex gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />50 minute booking window.</p>
            <p className="flex gap-2"><Shirt className="mt-0.5 h-4 w-4 shrink-0" />Bring comfortable clothes.</p>
            <p className="flex gap-2"><PenLine className="mt-0.5 h-4 w-4 shrink-0" />We will chat, then go through a movement assessment.</p>
          </div>
        </aside>

        <section className="min-w-0 border border-black/10 bg-white p-5 shadow-[0_24px_70px_-55px_rgba(0,0,0,0.45)] sm:p-7 lg:p-8">
          {step === 1 && (
            <div className="space-y-7">
              <div className="max-w-3xl">
                <p className="text-[0.62rem] uppercase tracking-[0.2em] text-black/35">Step 1</p>
                <h2 className="mt-2 font-display text-3xl font-light sm:text-4xl">PAR-Q and details</h2>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <Field label="First name" value={firstName} onChange={setFirstName} autoComplete="given-name" />
                <Field label="Last name" value={lastName} onChange={setLastName} autoComplete="family-name" />
                <Field label="Date of birth" value={dateOfBirth} onChange={setDateOfBirth} autoComplete="bday" type="date" />
                <div className="md:col-span-3">
                  <Field label="Email address" value={email} onChange={setEmail} autoComplete="email" type="email" />
                </div>
              </div>

              {medicalFlag && (
                <div className="flex gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>One or more answers are marked Yes. Pedro will review this before the movement assessment.</p>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[0.62rem] uppercase tracking-[0.18em] text-black/35">PAR-Q Questions</p>
                    <h3 className="mt-1 text-lg font-medium">Physical activity readiness</h3>
                  </div>
                  <span className="shrink-0 border border-black/10 px-3 py-1 text-xs text-black/55">{answeredCount}/{PAR_Q_QUESTIONS.length}</span>
                </div>
                <div className="space-y-2">
                  {PAR_Q_QUESTIONS.map((question, index) => (
                    <article key={question.id} className="grid gap-4 border border-black/8 bg-[#fbfbf8] p-4 md:grid-cols-[minmax(0,1fr)_13rem] md:items-center">
                      <div className="flex gap-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white text-xs text-black/45">{index + 1}</span>
                        <div>
                          <h4 className="text-sm font-medium">{question.label}</h4>
                          <p className="mt-1 text-sm leading-6 text-black/60">{question.text}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {(['yes', 'no'] as ParQAnswer[]).map((answer) => {
                          const selected = answers[question.id] === answer;
                          return (
                            <button
                              key={answer}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => setAnswer(question.id, answer)}
                              className={`min-h-11 flex-1 touch-manipulation select-none rounded-full border px-5 text-sm font-medium transition-colors ${
                                selected
                                  ? 'border-black bg-black text-white'
                                  : 'border-black/15 bg-white text-black/55 hover:border-black/40 hover:text-black'
                              }`}
                            >
                              {answer === 'yes' ? 'Yes' : 'No'}
                            </button>
                          );
                        })}
                      </div>
                      {question.id === 'other-medical' && answers[question.id] === 'yes' && (
                        <div className="md:col-span-2">
                          <textarea
                            value={otherMedicalNote}
                            onChange={(event) => setOtherMedicalNote(event.target.value)}
                            rows={2}
                            maxLength={400}
                            className="w-full resize-none border border-black/15 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-black/40"
                            placeholder="In a line or two, what is it? We'll chat about it in person."
                          />
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 border-t border-black/10 pt-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                <div>
                  <p className="text-[0.62rem] uppercase tracking-[0.18em] text-black/35">Consent</p>
                  <p className="mt-2 text-sm leading-6 text-black/60">{PAR_Q_CONSENT_TEXT}</p>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Client signature</p>
                    <button type="button" onClick={clearSignature} className="text-xs text-black/45 underline-offset-2 hover:text-black hover:underline">
                      Clear
                    </button>
                  </div>
                  <div className="relative mt-3 h-40 border border-black/15 bg-[#fbfbf8]">
                    {!hasSignature && <span className="pointer-events-none absolute left-4 top-4 text-sm text-black/30">Sign here</span>}
                    <canvas
                      ref={canvasRef}
                      onPointerDown={startDrawing}
                      onPointerMove={draw}
                      onPointerUp={stopDrawing}
                      onPointerCancel={stopDrawing}
                      className="h-full w-full touch-none"
                      aria-label="Signature pad"
                    />
                  </div>
                </div>
              </div>

              <ActionBar
                label={intakeReady ? 'Ready for the calendar' : 'Complete details, questions, and signature'}
                actionLabel="Continue"
                disabled={!intakeReady}
                onClick={continueToCalendar}
              />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="max-w-3xl">
                  <p className="text-[0.62rem] uppercase tracking-[0.2em] text-black/35">Step 2</p>
                  <h2 className="mt-2 font-display text-3xl font-light sm:text-4xl">Book your assessment</h2>
                </div>
                <button type="button" onClick={() => setStep(1)} className="inline-flex min-h-10 items-center gap-2 border border-black/10 px-4 text-sm text-black/55 hover:border-black/30 hover:text-black">
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <InfoTile title="Time" copy="Booked for 50 minutes. Most assessments run between 30 and 50 minutes." />
                <InfoTile title="Bring" copy="Comfortable clothes you can move in." />
                <InfoTile title="Session" copy="A short chat first, then a movement assessment with Pedro." />
              </div>

              <div className="border border-black/10 bg-[#fbfbf8] p-4">
                <label className="block">
                  <span className="text-sm font-medium">Anything the coach should know before the movement assessment?</span>
                  <textarea
                    value={coachNotes}
                    onChange={(event) => setCoachNotes(event.target.value)}
                    rows={4}
                    maxLength={1200}
                    className="mt-3 w-full resize-none border border-black/10 bg-white px-3 py-3 text-sm outline-none transition-colors focus:border-black/35"
                    placeholder="Injuries, pain, training history, goals, or anything you want Pedro to know."
                  />
                </label>
              </div>

              <div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[0.62rem] uppercase tracking-[0.18em] text-black/35">Calendar</p>
                    <h3 className="mt-1 text-lg font-medium">Available times</h3>
                  </div>
                  <button type="button" onClick={loadSlots} className="inline-flex min-h-10 items-center justify-center gap-2 border border-black/10 px-4 text-sm text-black/55 hover:border-black/30 hover:text-black">
                    <ChevronRight className="h-4 w-4" /> Refresh
                  </button>
                </div>

                {slotsLoading ? (
                  <div className="mt-4 border border-dashed border-black/15 py-10 text-center text-sm text-black/45">Loading available times...</div>
                ) : slotsError ? (
                  <div className="mt-4 border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">{slotsError}</div>
                ) : slots.length === 0 ? (
                  <div className="mt-4 border border-dashed border-black/15 py-10 text-center text-sm text-black/45">No available times are showing right now.</div>
                ) : (
                  <div className="mt-4 grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
                    <div className="flex gap-2 overflow-x-auto border border-black/10 bg-white p-2 lg:block lg:max-h-[30rem] lg:space-y-2 lg:overflow-y-auto">
                      {dates.map((date) => (
                        <button
                          key={date}
                          type="button"
                          onClick={() => {
                            setSelectedDate(date);
                            setSelectedSlot(null);
                          }}
                          className={`min-h-12 min-w-40 px-3 text-left text-sm transition-colors lg:w-full ${
                            (selectedDate || dates[0]) === date ? 'bg-black text-white' : 'bg-[#fbfbf8] text-black/55 hover:text-black'
                          }`}
                        >
                          {date}
                        </button>
                      ))}
                    </div>
                    <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {visibleSlots.map((slot) => (
                        <button
                          key={slot.start_at}
                          type="button"
                          onClick={() => setSelectedSlot(slot)}
                          className={`min-h-20 border px-4 py-3 text-left transition-colors ${
                            selectedSlot?.start_at === slot.start_at
                              ? 'border-black bg-black text-white'
                              : 'border-black/10 bg-white text-black hover:border-black/35'
                          }`}
                        >
                          <span className="block text-base font-medium">{slot.time_label}</span>
                          <span className="mt-1 block text-xs opacity-65">{slot.location ?? 'Location confirmed by Pedro'}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {submitError && <div className="border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">{submitError}</div>}

              <ActionBar
                label={selectedSlot ? selectedSlot.label : 'Choose an available time'}
                actionLabel={submitting ? 'Booking...' : 'Book assessment'}
                disabled={!selectedSlot || submitting}
                onClick={submitBooking}
              />
            </div>
          )}

          {step === 3 && (
            <div className="flex min-h-[34rem] items-center justify-center">
              <div className="max-w-xl text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-black text-white">
                  <Check className="h-5 w-5" />
                </div>
                <h2 className="mt-6 font-display text-4xl font-light">Thank you{firstName ? `, ${firstName}` : ''}.</h2>
                <p className="mt-4 text-lg text-black/75">You are booked in.</p>
                {confirmedSlot && (
                  <p className="mt-2 text-lg font-medium text-black">{confirmedSlot.date_label} · {confirmedSlot.time_label}</p>
                )}
                <p className="mt-6 text-sm leading-6 text-black/50">A confirmation has been sent to your email.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ProgressStep({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-3 text-sm ${active ? 'text-black' : done ? 'text-black/70' : 'text-black/35'}`}>
      <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${done ? 'border-black bg-black text-white' : active ? 'border-black' : 'border-black/15'}`}>
        {done ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      <span>{label}</span>
    </div>
  );
}

function Field({ label, value, onChange, autoComplete, type = 'text' }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        className="mt-2 h-12 w-full border border-black/10 bg-[#fbfbf8] px-3 text-sm outline-none transition-colors focus:border-black/35"
      />
    </label>
  );
}

function InfoTile({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="border border-black/10 bg-white px-4 py-4">
      <p className="text-[0.62rem] uppercase tracking-[0.16em] text-black/35">{title}</p>
      <p className="mt-2 text-sm leading-5 text-black/65">{copy}</p>
    </div>
  );
}

function ActionBar({ label, actionLabel, disabled, onClick }: {
  label: string;
  actionLabel: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 border border-black/10 bg-white p-3 md:flex-row md:items-center md:justify-between">
      <p className="text-sm text-black/55">{label}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="min-h-12 bg-black px-6 text-sm font-medium text-white transition-colors hover:bg-black/85 disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/35"
      >
        {actionLabel}
      </button>
    </div>
  );
}
