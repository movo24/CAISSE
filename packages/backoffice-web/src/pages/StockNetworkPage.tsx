import { useState, useEffect, useCallback } from 'react';
import {
  Warehouse, Store, Package, ArrowRight, Plus, Truck,
  AlertTriangle, TrendingUp, History, Search, RefreshCw,
  ChevronDown, ChevronRight, X,
} from 'lucide-react';
import { stockLocationsApi, productsApi } from '../services/api';

interface Location {
  id: string;
  name: string;
  code: string;
  type: string;
  storeId: string | null;
  isActive: boolean;
}

interface NetworkRow {
  locationId: string;
  locationName: string;
  locationCode: string;
  locationType: string;
  productId: string;
  productName: string;
  ean: string;
  quantity: number;
}

interface Movement {
  id: string;
  productName: string;
  productEan: string;
  movementType: string;
  fromLocationName: string | null;
  fromLocationCode: string | null;
  toLocationName: string | null;
  toLocationCode: string | null;
  quantity: number;
  reason: string;
  employeeName: string;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  supplier_receipt: 'Réception',
  transfer: 'Transfert',
  sale: 'Vente',
  return_customer: 'Retour client',
  return_supplier: 'Retour fournisseur',
  inventory_adjust: 'Inventaire',
  loss_breakage: 'Casse',
  loss_theft: 'Vol',
  loss_expired: 'Périmé',
  loss_unknown: 'Perte',
};

const TYPE_COLORS: Record<string, string> = {
  supplier_receipt: 'bg-emerald-50 text-emerald-700',
  transfer: 'bg-blue-50 text-blue-700',
  sale: 'bg-purple-50 text-purple-700',
  return_customer: 'bg-amber-50 text-amber-700',
  inventory_adjust: 'bg-cyan-50 text-cyan-700',
  loss_breakage: 'bg-red-50 text-red-700',
  loss_theft: 'bg-red-50 text-red-700',
  loss_expired: 'bg-orange-50 text-orange-700',
  loss_unknown: 'bg-gray-50 text-gray-700',
};

export function StockNetworkPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [networkData, setNetworkData] = useState<NetworkRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');

  // Modals
  const [showReceive, setShowReceive] = useState(false);
  const [showDispatch, setShowDispatch] = useState(false);
  const [showCreateLocation, setShowCreateLocation] = useState(false);

  // Forms
  const [receiveForm, setReceiveForm] = useState({ productId: '', locationId: '', quantity: '', reference: '' });
  const [dispatchForm, setDispatchForm] = useState({ productId: '', fromLocationId: '', dispatches: [] as { toLocationId: string; quantity: string }[] });
  const [locationForm, setLocationForm] = useState({ name: '', code: '', type: 'store' as string, storeId: '' });

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchAll = useCallback(async () => {
    try {
      const [locRes, netRes, prodRes] = await Promise.allSettled([
        stockLocationsApi.listLocations(),
        stockLocationsApi.networkStock(),
        productsApi.list(),
      ]);

      if (locRes.status === 'fulfilled') setLocations(locRes.value.data || []);
      if (netRes.status === 'fulfilled') setNetworkData(netRes.value.data || []);
      if (prodRes.status === 'fulfilled') {
        const d = prodRes.value.data;
        setProducts(Array.isArray(d) ? d : d?.data || []);
      }
    } catch {
      setError('Erreur chargement données stock');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Build pivot: product → { locationCode: qty }
  const pivotData = networkData.reduce((acc, row) => {
    if (!acc[row.productId]) {
      acc[row.productId] = { name: row.productName, ean: row.ean, locations: {}, total: 0 };
    }
    acc[row.productId].locations[row.locationCode] = row.quantity;
    acc[row.productId].total += row.quantity;
    return acc;
  }, {} as Record<string, { name: string; ean: string; locations: Record<string, number>; total: number }>);

  const locationCodes = [...new Set(locations.map((l) => l.code))];
  const central = locations.find((l) => l.type === 'central');
  const storeLocations = locations.filter((l) => l.type === 'store');

  const filteredProducts = Object.entries(pivotData)
    .filter(([, data]) => data.name.toLowerCase().includes(search.toLowerCase()) || data.ean.includes(search))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  // ── Receive ──
  const handleReceive = async () => {
    setError('');
    try {
      await stockLocationsApi.receive({
        productId: receiveForm.productId,
        locationId: receiveForm.locationId,
        quantity: parseInt(receiveForm.quantity, 10),
        reference: receiveForm.reference || undefined,
      });
      setSuccess('Réception enregistrée');
      setShowReceive(false);
      setReceiveForm({ productId: '', locationId: '', quantity: '', reference: '' });
      fetchAll();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur réception');
    }
  };

  // ── Dispatch ──
  const handleDispatch = async () => {
    setError('');
    try {
      await stockLocationsApi.dispatch({
        productId: dispatchForm.productId,
        fromLocationId: dispatchForm.fromLocationId,
        dispatches: dispatchForm.dispatches
          .filter((d) => parseInt(d.quantity, 10) > 0)
          .map((d) => ({ toLocationId: d.toLocationId, quantity: parseInt(d.quantity, 10) })),
      });
      setSuccess('Dispatch effectué');
      setShowDispatch(false);
      setDispatchForm({ productId: '', fromLocationId: '', dispatches: [] });
      fetchAll();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur dispatch');
    }
  };

  // ── Create Location ──
  const handleCreateLocation = async () => {
    setError('');
    try {
      await stockLocationsApi.createLocation({
        name: locationForm.name,
        code: locationForm.code,
        type: locationForm.type,
        storeId: locationForm.storeId || undefined,
      });
      setSuccess('Emplacement créé');
      setShowCreateLocation(false);
      setLocationForm({ name: '', code: '', type: 'store', storeId: '' });
      fetchAll();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur création');
    }
  };

  const openDispatch = (productId: string) => {
    if (!central) { setError('Aucun entrepôt central configuré'); return; }
    setDispatchForm({
      productId,
      fromLocationId: central.id,
      dispatches: storeLocations.map((l) => ({ toLocationId: l.id, quantity: '' })),
    });
    setShowDispatch(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={24} className="animate-spin text-bo-accent" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <Warehouse size={28} className="text-bo-accent" />
            Stock Réseau
          </h1>
          <p className="text-sm text-bo-muted mt-1">
            {locations.length} emplacements · {Object.keys(pivotData).length} produits
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateLocation(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-bo-border text-sm font-semibold text-bo-text hover:bg-bo-subtle transition-colors"
          >
            <Plus size={16} /> Emplacement
          </button>
          <button
            onClick={() => { setShowReceive(true); if (central) setReceiveForm((f) => ({ ...f, locationId: central.id })); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors"
          >
            <Truck size={16} /> Réception
          </button>
        </div>
      </div>

      {/* Success/Error */}
      {success && <div className="mb-4 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 font-semibold">{success}</div>}
      {error && <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 font-semibold">{error}</div>}

      {/* Location cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {locations.map((loc) => {
          const totalQty = networkData.filter((r) => r.locationId === loc.id).reduce((s, r) => s + r.quantity, 0);
          const productCount = new Set(networkData.filter((r) => r.locationId === loc.id).map((r) => r.productId)).size;
          return (
            <div key={loc.id} className="p-4 rounded-2xl border border-bo-border bg-bo-card hover:shadow-card transition-shadow">
              <div className="flex items-center gap-2 mb-2">
                {loc.type === 'central' ? <Warehouse size={16} className="text-bo-accent" /> : <Store size={16} className="text-emerald-600" />}
                <span className="text-xs font-bold text-bo-muted uppercase">{loc.type === 'central' ? 'Entrepôt' : 'Magasin'}</span>
              </div>
              <p className="text-sm font-bold text-bo-text">{loc.name}</p>
              <p className="text-[10px] font-mono text-bo-muted">{loc.code}</p>
              <div className="flex gap-3 mt-2">
                <span className="text-xs text-bo-muted">{productCount} produits</span>
                <span className="text-xs font-bold text-bo-text">{totalQty.toLocaleString()} unités</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-bo-muted" />
        <input
          type="text"
          placeholder="Rechercher produit..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-3 rounded-xl border border-bo-border text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30"
        />
      </div>

      {/* Stock table */}
      {locations.length === 0 ? (
        <div className="text-center py-16">
          <Warehouse size={48} className="text-bo-muted/30 mx-auto mb-4" />
          <p className="text-bo-muted font-semibold">Aucun emplacement configuré</p>
          <p className="text-sm text-bo-muted mt-1">Créez un entrepôt central puis vos magasins</p>
          <button
            onClick={() => setShowCreateLocation(true)}
            className="mt-4 px-6 py-2.5 rounded-xl bg-bo-accent text-white text-sm font-bold"
          >
            Créer un emplacement
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-bo-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bo-subtle/50">
                <th className="text-left px-4 py-3 font-semibold text-bo-muted">Produit</th>
                <th className="text-center px-3 py-3 font-semibold text-bo-muted">Total</th>
                {locations.map((l) => (
                  <th key={l.id} className="text-center px-3 py-3 font-semibold text-bo-muted">
                    <div className="flex items-center justify-center gap-1">
                      {l.type === 'central' ? <Warehouse size={12} /> : <Store size={12} />}
                      <span className="text-[10px]">{l.code}</span>
                    </div>
                  </th>
                ))}
                <th className="text-center px-3 py-3 font-semibold text-bo-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map(([pid, data]) => (
                <tr key={pid} className="border-t border-bo-border/50 hover:bg-bo-subtle/30">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-bo-text">{data.name}</p>
                    <p className="text-[10px] font-mono text-bo-muted">{data.ean}</p>
                  </td>
                  <td className="text-center px-3 py-3 font-bold text-bo-text">{data.total}</td>
                  {locations.map((l) => {
                    const qty = data.locations[l.code] ?? 0;
                    return (
                      <td key={l.id} className={`text-center px-3 py-3 font-semibold ${qty === 0 ? 'text-bo-muted' : qty < 5 ? 'text-red-600' : 'text-bo-text'}`}>
                        {qty}
                      </td>
                    );
                  })}
                  <td className="text-center px-3 py-3">
                    <button
                      onClick={() => openDispatch(pid)}
                      className="text-[10px] font-bold text-bo-accent hover:underline"
                      title="Dispatcher vers magasins"
                    >
                      Dispatcher
                    </button>
                  </td>
                </tr>
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={locations.length + 3} className="text-center py-8 text-bo-muted">
                    {networkData.length === 0 ? 'Aucun stock enregistré. Commencez par une réception.' : 'Aucun produit trouvé'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── MODAL: Réception fournisseur ── */}
      {showReceive && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-elevated w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Réception fournisseur</h2>
              <button onClick={() => setShowReceive(false)}><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-bo-muted mb-1">Produit</label>
                <select
                  value={receiveForm.productId}
                  onChange={(e) => setReceiveForm((f) => ({ ...f, productId: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-bo-border text-sm"
                >
                  <option value="">Sélectionner...</option>
                  {products.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.ean})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-muted mb-1">Emplacement</label>
                <select
                  value={receiveForm.locationId}
                  onChange={(e) => setReceiveForm((f) => ({ ...f, locationId: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-bo-border text-sm"
                >
                  <option value="">Sélectionner...</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-muted mb-1">Quantité</label>
                <input
                  type="number"
                  value={receiveForm.quantity}
                  onChange={(e) => setReceiveForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-bo-border text-sm"
                  min="1"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-muted mb-1">N° BL / Référence</label>
                <input
                  type="text"
                  value={receiveForm.reference}
                  onChange={(e) => setReceiveForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="BL-2026-0001"
                  className="w-full px-3 py-2.5 rounded-xl border border-bo-border text-sm"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                onClick={handleReceive}
                disabled={!receiveForm.productId || !receiveForm.locationId || !receiveForm.quantity}
                className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold text-sm disabled:opacity-40"
              >
                Enregistrer la réception
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Dispatch ── */}
      {showDispatch && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-elevated w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Dispatcher vers magasins</h2>
              <button onClick={() => setShowDispatch(false)}><X size={18} /></button>
            </div>
            <p className="text-xs text-bo-muted mb-4">
              Depuis : {central?.name} ({central?.code})
            </p>
            <div className="space-y-3">
              {dispatchForm.dispatches.map((d, i) => {
                const loc = locations.find((l) => l.id === d.toLocationId);
                return (
                  <div key={d.toLocationId} className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-bo-text w-32 truncate">{loc?.name}</span>
                    <input
                      type="number"
                      value={d.quantity}
                      onChange={(e) => {
                        const updated = [...dispatchForm.dispatches];
                        updated[i] = { ...updated[i], quantity: e.target.value };
                        setDispatchForm((f) => ({ ...f, dispatches: updated }));
                      }}
                      placeholder="0"
                      min="0"
                      className="flex-1 px-3 py-2 rounded-lg border border-bo-border text-sm text-center"
                    />
                  </div>
                );
              })}
            </div>
            {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
            <button
              onClick={handleDispatch}
              disabled={dispatchForm.dispatches.every((d) => !d.quantity || parseInt(d.quantity, 10) <= 0)}
              className="w-full mt-4 py-3 rounded-xl bg-bo-accent text-white font-bold text-sm disabled:opacity-40"
            >
              Dispatcher
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL: Create Location ── */}
      {showCreateLocation && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-elevated w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Nouvel emplacement</h2>
              <button onClick={() => setShowCreateLocation(false)}><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-bo-muted mb-1">Type</label>
                <select
                  value={locationForm.type}
                  onChange={(e) => setLocationForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-bo-border text-sm"
                >
                  <option value="central">Entrepôt central</option>
                  <option value="store">Magasin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-muted mb-1">Nom</label>
                <input
                  type="text"
                  value={locationForm.name}
                  onChange={(e) => setLocationForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Entrepôt Rungis"
                  className="w-full px-3 py-2.5 rounded-xl border border-bo-border text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-bo-muted mb-1">Code</label>
                <input
                  type="text"
                  value={locationForm.code}
                  onChange={(e) => setLocationForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="CENTRAL-001"
                  className="w-full px-3 py-2.5 rounded-xl border border-bo-border text-sm font-mono"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                onClick={handleCreateLocation}
                disabled={!locationForm.name || !locationForm.code}
                className="w-full py-3 rounded-xl bg-bo-accent text-white font-bold text-sm disabled:opacity-40"
              >
                Créer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
