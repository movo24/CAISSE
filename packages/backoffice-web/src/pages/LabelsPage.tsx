import { useState, useEffect, useCallback, useRef } from 'react';
import { Tag, Printer, Search, Check, Download, Plus, Minus, X, FileText, History } from 'lucide-react';
import { productsApi } from '../services/api';
import JsBarcode from 'jsbarcode';

/** Generate barcode SVG string for a given EAN */
function generateBarcodeSVG(ean: string, height: number): string {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, ean, {
      format: ean.length === 13 ? 'EAN13' : ean.length === 8 ? 'EAN8' : 'CODE128',
      width: 1.2,
      height,
      displayValue: false,
      margin: 0,
    });
    return svg.outerHTML;
  } catch {
    // Fallback: just show the EAN text if barcode generation fails
    return `<span style="font-family:monospace;font-size:8px;">[${ean}]</span>`;
  }
}

interface Product {
  id: string;
  ean: string;
  name: string;
  priceMinorUnits: number;
  oldPriceMinorUnits: number | null;
  currencyCode: string;
  taxRate: string;
  unitType: string;
}

interface CartItem {
  product: Product;
  quantity: number;
}

type LabelSize = 'small' | 'medium' | 'large';
type ActiveTab = 'print' | 'history';

const LABEL_SIZES: Record<LabelSize, { label: string; w: number; h: number; desc: string }> = {
  small: { label: 'Petit', w: 40, h: 25, desc: '40x25mm — gondole' },
  medium: { label: 'Moyen', w: 60, h: 40, desc: '60x40mm — standard' },
  large: { label: 'Grand', w: 100, h: 60, desc: '100x60mm — vitrine' },
};

function formatPrice(minorUnits: number, currency: string): string {
  const major = (minorUnits / 100).toFixed(2);
  return currency === 'EUR' ? `${major} \u20AC` : `${major} ${currency}`;
}

export function LabelsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [labelSize, setLabelSize] = useState<LabelSize>('medium');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState<ActiveTab>('print');
  const [printHistory, setPrintHistory] = useState<{ date: string; count: number; size: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('caisse_label_history') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    productsApi.list().then((res) => {
      setProducts(res.data?.data || res.data || []);
      setLoading(false);
    }).catch(() => { setLoading(false); console.error('[Labels] Failed to load products'); });
  }, []);

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.ean.includes(search),
  );

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) return prev.map((i) => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => i.product.id === productId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)
        .filter((i) => i.quantity > 0),
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  };

  const totalLabels = cart.reduce((s, i) => s + i.quantity, 0);

  const generatePDF = useCallback(() => {
    if (cart.length === 0) return;
    setGenerating(true);

    const size = LABEL_SIZES[labelSize];
    const titleSize = labelSize === 'small' ? 9 : labelSize === 'medium' ? 12 : 16;
    const priceSize = labelSize === 'small' ? 22 : labelSize === 'medium' ? 36 : 52;
    const metaSize = labelSize === 'small' ? 6 : labelSize === 'medium' ? 8 : 10;
    const eanSize = labelSize === 'small' ? 5 : labelSize === 'medium' ? 7 : 9;
    const today = new Date().toLocaleDateString('fr-FR');

    const allLabels = cart.flatMap((item) =>
      Array.from({ length: item.quantity }, () => item.product),
    );

    const labelsHTML = allLabels.map((p) => {
      const priceMajor = Math.floor(p.priceMinorUnits / 100);
      const priceMinor = String(p.priceMinorUnits % 100).padStart(2, '0');
      const symbol = p.currencyCode === 'EUR' ? '\u20AC' : p.currencyCode;

      // Promo: ancien prix barré si oldPrice > currentPrice
      const isPromo = p.oldPriceMinorUnits != null && p.oldPriceMinorUnits > p.priceMinorUnits;
      const oldPriceFormatted = isPromo ? `${(p.oldPriceMinorUnits! / 100).toFixed(2)} ${symbol}` : '';

      // Prix unitaire conditionnel
      const unitMap: Record<string, string> = { l: 'L', ml: 'L', kg: 'kg', pair: 'paire' };
      const unitSuffix = unitMap[p.unitType] || '';
      const pricePerUnitText = unitSuffix
        ? `${(p.priceMinorUnits / 100).toFixed(2)} ${symbol}/${unitSuffix}`
        : 'Prix unitaire';

      const pad = labelSize === 'small' ? '1.5mm 2mm' : labelSize === 'medium' ? '2.5mm 3.5mm' : '3mm 5mm';
      const barcodeH = labelSize === 'small' ? '5mm' : labelSize === 'medium' ? '8mm' : '12mm';
      // Prix en rouge si promo, noir sinon
      const priceColor = isPromo ? '#CC0000' : '#000';

      return `
      <div style="
        width:${size.w}mm;height:${size.h}mm;
        border:2px solid #555;border-radius:2mm;
        background:#e8e8e8;
        font-family:Arial,Helvetica,sans-serif;
        page-break-inside:avoid;box-sizing:border-box;
        display:flex;flex-direction:column;
        overflow:hidden;
      ">
        <!-- TITRE: centré, rouge foncé, uppercase -->
        <div style="
          padding:${pad};padding-bottom:${labelSize === 'small' ? '1mm' : '1.5mm'};
          font-size:${titleSize}px;font-weight:900;
          color:#8B0000;text-transform:uppercase;
          text-align:center;letter-spacing:0.5px;
          line-height:1.15;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        ">${p.name}</div>

        <!-- SEPARATEUR -->
        <div style="width:calc(100% - 4mm);height:1.5px;background:#333;margin:0 auto;"></div>

        <!-- ZONE CENTRALE: prix unitaire gauche + ancien prix barré + PRIX GEANT droite -->
        <div style="display:flex;align-items:center;padding:${pad};flex:1;">
          <div style="flex:1;">
            <div style="font-size:${metaSize}px;font-weight:700;color:#333;">${pricePerUnitText}</div>
            ${isPromo ? `<div style="font-size:${Math.round(priceSize * 0.35)}px;color:#333;text-decoration:line-through;margin-top:1mm;">${oldPriceFormatted}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <span style="font-size:${priceSize}px;font-weight:900;color:${priceColor};letter-spacing:-1px;">${priceMajor}</span><span style="font-size:${Math.round(priceSize * 0.55)}px;font-weight:900;color:${priceColor};">,${priceMinor}</span>
          </div>
        </div>

        <!-- ZONE BASSE: code-barres gauche + TVA/date droite -->
        <div style="display:flex;align-items:flex-end;padding:${pad};padding-top:0;gap:2mm;">
          <!-- Code-barres + EAN -->
          <div style="flex:1;">
            <div style="height:${barcodeH};overflow:hidden;">
              ${generateBarcodeSVG(p.ean, labelSize === 'small' ? 20 : labelSize === 'medium' ? 30 : 45)}
            </div>
            <div style="font-size:${eanSize}px;color:#333;font-family:monospace;margin-top:0.5mm;letter-spacing:1px;">${p.ean}</div>
          </div>
          <!-- TVA + date -->
          <div style="text-align:right;">
            <div style="font-size:${metaSize}px;font-weight:700;color:#333;">TVA ${p.taxRate}% incl.</div>
            <div style="font-size:${metaSize}px;color:#555;">${today}</div>
          </div>
        </div>
      </div>`;
    }).join('');

    // Fix: wait for DOM render before print (prevents "page not finished loading")
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquettes CAISSE</title>
      <style>
        @page{margin:5mm;size:auto}
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:#fff}
        .grid{display:flex;flex-wrap:wrap;gap:2mm;padding:2mm}
      </style>
      </head><body>
        <div class="grid">${labelsHTML}</div>
        <script>
          // Wait for full render before printing
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){
              setTimeout(function(){ window.print(); }, 300);
            });
          });
        </script>
      </body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `etiquettes-${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    // Save to history
    const entry = { date: new Date().toISOString(), count: totalLabels, size: LABEL_SIZES[labelSize].label };
    const newHistory = [entry, ...printHistory].slice(0, 50);
    setPrintHistory(newHistory);
    localStorage.setItem('caisse_label_history', JSON.stringify(newHistory));

    setGenerating(false);
  }, [cart, labelSize, totalLabels, printHistory]);

  const generateZPL = useCallback(() => {
    if (cart.length === 0) return;
    const allLabels = cart.flatMap((item) => Array.from({ length: item.quantity }, () => item.product));
    const zpl = allLabels.map((p) => [
      '^XA', '^CF0,30', `^FO20,20^FD${p.name.slice(0, 30)}^FS`,
      '^CF0,50', `^FO20,60^FD${formatPrice(p.priceMinorUnits, p.currencyCode)}^FS`,
      '^CF0,20', `^FO20,120^FDTVA ${p.taxRate}%^FS`,
      `^BY2,2,60^FO20,150^BC,,Y,N^FD${p.ean}^FS`, '^XZ',
    ].join('\n')).join('\n\n');

    const blob = new Blob([zpl], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `etiquettes-${new Date().toISOString().slice(0, 10)}.zpl`;
    a.click();
  }, [cart]);

  return (
    <div className="p-6 max-w-6xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-bo-text flex items-center gap-3">
            <Tag size={24} className="text-bo-accent" />
            Etiquettes
          </h1>
          <p className="text-sm text-bo-muted mt-1">Selectionnez des produits, ajustez les quantites, imprimez</p>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 bg-bo-subtle rounded-xl p-1">
          <button onClick={() => setTab('print')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${tab === 'print' ? 'bg-bo-card shadow-soft text-bo-text' : 'text-bo-muted'}`}>
            <Printer size={14} /> Impression
          </button>
          <button onClick={() => setTab('history')} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${tab === 'history' ? 'bg-bo-card shadow-soft text-bo-text' : 'text-bo-muted'}`}>
            <History size={14} /> Historique
          </button>
        </div>
      </div>

      {tab === 'history' ? (
        <div className="bg-bo-card rounded-2xl border border-bo-border p-5">
          <h3 className="text-sm font-bold text-bo-text mb-4">Historique d'impression</h3>
          {printHistory.length === 0 ? (
            <p className="text-sm text-bo-muted text-center py-8">Aucune impression</p>
          ) : (
            <div className="space-y-2">
              {printHistory.map((h, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-bo-subtle">
                  <span className="text-xs text-bo-muted">{new Date(h.date).toLocaleString('fr-FR')}</span>
                  <span className="text-xs font-bold text-bo-text">{h.count} etiquette{h.count > 1 ? 's' : ''}</span>
                  <span className="text-[10px] text-bo-muted">{h.size}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Product list */}
          <div className="lg:col-span-2 bg-bo-card rounded-2xl border border-bo-border p-5">
            <div className="relative mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-bo-muted" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par nom ou EAN..." className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-bo-border text-sm focus:outline-none focus:ring-2 focus:ring-bo-accent/30" />
            </div>

            {loading ? (
              <p className="text-center text-bo-muted py-8">Chargement...</p>
            ) : (
              <div className="space-y-1 max-h-[500px] overflow-y-auto">
                {filtered.map((p) => {
                  const inCart = cart.find((i) => i.product.id === p.id);
                  return (
                    <button key={p.id} onClick={() => addToCart(p)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all ${inCart ? 'bg-bo-accent/5 border border-bo-accent/20' : 'hover:bg-bo-subtle border border-transparent'}`}>
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${inCart ? 'bg-bo-accent text-white' : 'border-2 border-bo-border'}`}>
                        {inCart ? <Check size={12} strokeWidth={3} /> : <Plus size={12} className="text-bo-muted" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-bo-text truncate">{p.name}</p>
                        <p className="text-xs text-bo-muted font-mono">{p.ean}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-bo-text">{formatPrice(p.priceMinorUnits, p.currencyCode)}</p>
                        {inCart && <p className="text-[10px] text-bo-accent font-bold">x{inCart.quantity}</p>}
                      </div>
                    </button>
                  );
                })}
                {filtered.length === 0 && <p className="text-center text-bo-muted py-8">Aucun produit</p>}
              </div>
            )}
          </div>

          {/* Right panel */}
          <div className="space-y-4">
            {/* Cart */}
            <div className="bg-bo-card rounded-2xl border border-bo-border p-5">
              <h3 className="text-sm font-bold text-bo-text mb-3 flex items-center justify-between">
                Panier ({totalLabels} etiquette{totalLabels > 1 ? 's' : ''})
                {cart.length > 0 && <button onClick={() => setCart([])} className="text-[10px] text-bo-muted hover:text-bo-danger">Vider</button>}
              </h3>
              {cart.length === 0 ? (
                <p className="text-xs text-bo-muted text-center py-4">Cliquez sur un produit pour l'ajouter</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {cart.map((item) => (
                    <div key={item.product.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bo-subtle">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-bo-text truncate">{item.product.name}</p>
                        <p className="text-[10px] text-bo-muted">{formatPrice(item.product.priceMinorUnits, item.product.currencyCode)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateQty(item.product.id, -1)} className="w-6 h-6 rounded-lg bg-bo-card border border-bo-border flex items-center justify-center hover:bg-bo-danger/10">
                          <Minus size={10} />
                        </button>
                        <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                        <button onClick={() => updateQty(item.product.id, 1)} className="w-6 h-6 rounded-lg bg-bo-card border border-bo-border flex items-center justify-center hover:bg-bo-accent/10">
                          <Plus size={10} />
                        </button>
                        <button onClick={() => removeFromCart(item.product.id)} className="w-6 h-6 rounded-lg flex items-center justify-center text-bo-muted hover:text-bo-danger">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Label size */}
            <div className="bg-bo-card rounded-2xl border border-bo-border p-5">
              <h3 className="text-sm font-bold text-bo-text mb-3">Format</h3>
              <div className="space-y-2">
                {(Object.entries(LABEL_SIZES) as [LabelSize, typeof LABEL_SIZES[LabelSize]][]).map(([key, val]) => (
                  <button key={key} onClick={() => setLabelSize(key)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-all ${labelSize === key ? 'bg-bo-accent/10 border border-bo-accent/30 text-bo-accent' : 'border border-bo-border hover:bg-bo-subtle'}`}>
                    <div className={`rounded border-2 flex-shrink-0 ${labelSize === key ? 'border-bo-accent' : 'border-bo-border'}`}
                      style={{ width: `${val.w / 4}px`, height: `${val.h / 4}px` }} />
                    <div>
                      <p className="text-xs font-bold">{val.label}</p>
                      <p className="text-[10px] text-bo-muted">{val.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <button onClick={generatePDF} disabled={cart.length === 0 || generating}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-bo-accent text-white font-bold text-sm hover:opacity-90 disabled:opacity-40 transition-all shadow-lg shadow-bo-accent/25">
                <Printer size={16} />
                {generating ? 'Generation...' : `Imprimer ${totalLabels} etiquette${totalLabels > 1 ? 's' : ''}`}
              </button>
              <button onClick={generateZPL} disabled={cart.length === 0}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-bo-border text-bo-text font-bold text-sm hover:bg-bo-subtle transition-all">
                <Download size={16} /> Exporter ZPL (Zebra)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
