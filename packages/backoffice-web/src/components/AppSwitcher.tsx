import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, ShoppingBag, Clock } from 'lucide-react';
import { useAuthStore, AppType } from '../stores/authStore';

const APPS: { key: AppType; label: string; icon: React.ElementType; accent: string }[] = [
  { key: 'pos', label: 'CAISSE POS', icon: ShoppingBag, accent: '#6366f1' },
  { key: 'timewin24', label: 'TimeWin24', icon: Clock, accent: '#8b5cf6' },
];

export function AppSwitcher() {
  const { currentApp, setCurrentApp } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = APPS.find((a) => a.key === currentApp) || APPS[0];
  const CurrentIcon = current.icon;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative px-5 py-5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 w-full group"
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
          style={{ backgroundColor: current.accent }}
        >
          <CurrentIcon size={16} className="text-white" strokeWidth={2.5} />
        </div>
        <div className="flex-1 text-left">
          <h1 className="text-white text-sm font-bold tracking-wide">{current.label}</h1>
          <p className="text-white/30 text-[10px] font-medium">Back-Office</p>
        </div>
        <ChevronDown
          size={14}
          className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 bg-white rounded-xl shadow-elevated border border-gray-100 overflow-hidden z-50 animate-fade-in">
          {APPS.map((app) => {
            const Icon = app.icon;
            const isActive = app.key === currentApp;
            return (
              <button
                key={app.key}
                onClick={() => {
                  setCurrentApp(app.key);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-50 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: isActive ? app.accent : `${app.accent}20` }}
                >
                  <Icon size={14} className={isActive ? 'text-white' : ''} style={!isActive ? { color: app.accent } : {}} />
                </div>
                <span>{app.label}</span>
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: app.accent }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
