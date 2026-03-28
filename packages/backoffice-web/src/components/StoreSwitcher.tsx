import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Store, Search } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export function StoreSwitcher() {
  const { stores, currentStoreId, setCurrentStore, employee } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click — must be called before any conditional return (React rules of hooks)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Only show for admins with multiple stores
  if (employee?.role !== 'admin' || stores.length <= 1) return null;

  const current = stores.find((s) => s.id === currentStoreId);
  const filtered = stores.filter(
    (s) =>
      s.isActive &&
      (s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.city || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.storeCode || '').toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div ref={ref} className="relative px-3 mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors"
      >
        <Store size={14} className="text-white/40" />
        <span className="flex-1 text-left text-xs text-white/60 font-medium truncate">
          {current?.name || 'Sélectionner'}
        </span>
        <ChevronDown
          size={12}
          className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-3 right-3 bottom-full mb-1 bg-white rounded-xl shadow-elevated border border-gray-100 overflow-hidden z-50 max-h-64 animate-fade-in">
          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-bo-accent/30"
                autoFocus
              />
            </div>
          </div>

          {/* Store list */}
          <div className="overflow-y-auto max-h-48">
            {filtered.map((store) => (
              <button
                key={store.id}
                onClick={() => {
                  setCurrentStore(store.id);
                  setOpen(false);
                  setSearch('');
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                  store.id === currentStoreId
                    ? 'bg-bo-accent/5 text-bo-accent font-semibold'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    store.id === currentStoreId ? 'bg-bo-accent' : 'bg-gray-300'
                  }`}
                />
                <span className="truncate">{store.name}</span>
                {store.storeCode && (
                  <span className="ml-auto text-[10px] font-mono text-gray-400">
                    {store.storeCode}
                  </span>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-3">Aucun résultat</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
