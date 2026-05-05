"use client";

import { useEffect, useState } from "react";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-5 bg-white/90 backdrop-blur-md transition-[border-color] duration-300 ${
        scrolled ? "border-b border-black" : "border-b border-transparent"
      }`}
    >
      <a
        href="#"
        className="font-display text-sm font-medium tracking-[0.12em] uppercase text-black no-underline"
      >
        Cerebro
      </a>
      <a
        href="#start"
        className="text-[0.7rem] font-medium tracking-[0.12em] uppercase text-black border border-black px-5 py-2.5 no-underline transition-[background,color] duration-200 hover:bg-black hover:text-white"
      >
        Start the conversation
      </a>
    </nav>
  );
}
