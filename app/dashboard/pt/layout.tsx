import PTNav from './PTNav';

export default function PTLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-1.5rem)] min-w-0 flex-col gap-3 md:flex-row">
      <PTNav />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
