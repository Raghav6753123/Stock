'use client';

import { useEffect, useState } from 'react';
import { BrandLogo } from '@/components/brand-logo';

export default function InitialLoader() {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) return 100;
        return prev + 100 / 25;
      });
    }, 100);

    const fadeTimer = setTimeout(() => setFadeOut(true), 2400);
    const hideTimer = setTimeout(() => setVisible(false), 2800);

    return () => {
      clearInterval(progressInterval);
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-background transition-opacity duration-400 ${
        fadeOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex flex-col items-center gap-10">
        {/* Logo + Name */}
        <BrandLogo className="h-14 w-auto max-w-[280px] rounded-lg bg-white px-2 py-1" priority />

        {/* Pulse ring spinner */}
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-[3px] border-border" />
          <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-primary animate-spin" />
          <div
            className="absolute inset-[6px] rounded-full border-[2px] border-transparent border-t-primary/40 animate-spin"
            style={{ animationDirection: 'reverse', animationDuration: '1.2s' }}
          />
        </div>

        {/* Progress bar */}
        <div className="w-52">
          <div className="h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-100 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3 font-medium">
            Loading market data...
          </p>
        </div>
      </div>
    </div>
  );
}
