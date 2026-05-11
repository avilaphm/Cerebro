import PTNav from './PTNav';

export default function PTLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <PTNav />
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
