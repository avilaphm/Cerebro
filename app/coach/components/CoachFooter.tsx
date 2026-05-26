export default function CoachFooter() {
  return (
    <footer className="py-12 md:py-16 px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">

          <div>
            <p className="font-display text-base font-light tracking-[-0.01em] text-black">
              Pedro Avila Coaching
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <p className="text-[0.7rem] font-light text-black/50">
              P.E. Dept, Potts Point · Sydney, NSW
            </p>
            <p className="text-[0.7rem] font-light text-black/50">
              Instagram: @meet.avila
            </p>
          </div>

          <div>
            <p className="text-[0.7rem] font-light text-black/50">© 2026</p>
          </div>

        </div>

        <p className="text-[0.65rem] font-light text-black/25 mt-10">Chuuur.</p>
      </div>
    </footer>
  );
}
