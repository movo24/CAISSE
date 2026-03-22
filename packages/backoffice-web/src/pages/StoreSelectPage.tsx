import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, Search, MapPin, Loader2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export function StoreSelectPage() {
  const navigate = useNavigate();
  const { stores, loadStores, setCurrentStore, employee, currentStoreId } = useAuthStore();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [storesLoaded, setStoresLoaded] = useState(false);

  useEffect(() => {
    loadStores().then(() => {
      setLoading(false);
      setStoresLoaded(true);
    });
  }, []);

  // Only auto-skip AFTER stores are fully loaded and confirmed
  useEffect(() => {
    if (!storesLoaded) return; // Wait until loadStores() has completed

    const storeCount = stores.filter((s) => s.isActive).length;

    // Non-admin → go to dashboard
    if (employee?.role !== 'admin') {
      if (storeCount === 1) setCurrentStore(stores[0].id);
      navigate('/', { replace: true });
      return;
    }

    // Admin with exactly 1 store → auto-select and skip
    if (storeCount === 1) {
      setCurrentStore(stores[0].id);
      navigate('/', { replace: true });
      return;
    }

    // Admin with 0 stores → go to dashboard (nothing to select)
    if (storeCount === 0) {
      navigate('/', { replace: true });
    }

    // Admin with 2+ stores → stay on this page (don't navigate)
  }, [storesLoaded]);

  const filtered = stores.filter(
    (s) =>
      s.isActive &&
      (s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.city || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.storeCode || '').toLowerCase().includes(search.toLowerCase())),
  );

  const handleSelect = (storeId: string) => {
    setCurrentStore(storeId);
    navigate('/', { replace: true });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bo-bg">
        <Loader2 size={32} className="animate-spin text-bo-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bo-bg flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-bo-accent flex items-center justify-center mx-auto mb-4">
            <Store size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-bo-text">Sélectionnez un magasin</h1>
          <p className="text-bo-muted text-sm mt-1">
            Bonjour {employee?.firstName}, choisissez le magasin à gérer
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-6 max-w-md mx-auto">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-bo-muted" />
          <input
            type="text"
            placeholder="Rechercher par nom, ville ou code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 rounded-xl border border-bo-border bg-bo-card text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
            autoFocus
          />
        </div>

        {/* Store grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((store) => (
            <button
              key={store.id}
              onClick={() => handleSelect(store.id)}
              className={`text-left p-5 rounded-2xl border transition-all hover:shadow-card ${
                store.id === currentStoreId
                  ? 'border-bo-accent bg-bo-accent/5 shadow-card'
                  : 'border-bo-border bg-bo-card hover:border-bo-accent/30'
              }`}
            >
              <h3 className="font-bold text-bo-text text-sm">{store.name}</h3>
              {store.storeCode && (
                <span className="inline-block mt-1 text-[10px] font-mono font-semibold text-bo-accent bg-bo-accent/10 px-2 py-0.5 rounded-md">
                  {store.storeCode}
                </span>
              )}
              {store.city && (
                <p className="flex items-center gap-1 text-xs text-bo-muted mt-2">
                  <MapPin size={11} /> {store.city}
                </p>
              )}
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <p className="text-center text-bo-muted text-sm mt-8">Aucun magasin trouvé</p>
        )}
      </div>
    </div>
  );
}
