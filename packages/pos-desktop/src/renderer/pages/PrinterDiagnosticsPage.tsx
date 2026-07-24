import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Printer, Inbox, RefreshCw, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';
import { peripheralBridge, getPaperWidthMm, setPaperWidthMm, type PaperWidthMm } from '../services/peripheralBridge';
import {
  getDrawerQueueName,
  getDrawerStrategy,
  printerModeLabel,
  setDrawerQueueName,
  setDrawerStrategy,
  type DrawerStrategy,
} from '../services/drawerStrategy';
import { printChainTrace } from '../services/printChainTrace';

/**
 * Écran diagnostic périphériques (desktop Windows). Permet, sur le poste, de :
 *  - lister les imprimantes de l'OS et CHOISIR celle utilisée (persisté) ;
 *  - afficher le nom/type/statut de l'imprimante et du tiroir ;
 *  - lancer une IMPRESSION TEST réelle (honnête : succès seulement si l'OS
 *    confirme) ;
 *  - lancer une OUVERTURE TIROIR de test (kick ESC/POS via spooler RAW) ;
 *  - voir le dernier message d'erreur.
 *
 * Aucune donnée fiscale ; purement matériel/diagnostic.
 */
type TestResult = { ok: boolean; msg: string } | null;

export function PrinterDiagnosticsPage() {
  const navigate = useNavigate();
  const [printers, setPrinters] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(peripheralBridge.getSelectedOsPrinter());
  const [status, setStatus] = useState(peripheralBridge.status);
  const [loadingList, setLoadingList] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [printResult, setPrintResult] = useState<TestResult>(null);
  const [paperWidth, setPaperWidth] = useState<PaperWidthMm>(getPaperWidthMm());
  const [drawerResult, setDrawerResult] = useState<TestResult>(null);
  const [drawerStrategy, setDrawerStrategyState] = useState<DrawerStrategy>(getDrawerStrategy());
  const [drawerQueue, setDrawerQueueState] = useState<string>(getDrawerQueueName() ?? '');

  const isDesktop = typeof window !== 'undefined' && (window as any).electronAPI?.getPrinters;

  const refresh = async () => {
    setLoadingList(true);
    try {
      const list: string[] = (await (window as any).electronAPI?.getPrinters?.()) || [];
      setPrinters(list);
    } catch {
      setPrinters([]);
    } finally {
      setStatus({ ...peripheralBridge.status });
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (isDesktop) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choosePrinter = async (name: string) => {
    setSelected(name);
    await peripheralBridge.setSelectedOsPrinter(name);
    setStatus({ ...peripheralBridge.status });
  };

  const runTestPrint = async () => {
    setPrintBusy(true);
    setPrintResult(null);
    try {
      const ok = await peripheralBridge.printTicket(
        {
          storeName: 'POS CAISSE',
          storeAddress: '', siret: '', tvaIntracom: '',
          ticketNumber: 'TEST-IMPRESSION',
          date: new Date().toLocaleString('fr-FR'),
          cashierName: 'Diagnostic',
          items: [{ name: 'Impression de test — éàçùî', quantity: 1, unitPrice: 0, total: 0 }],
          subtotal: 0, discount: 0, total: 0,
          payments: [], change: 0,
          footer: 'Test imprimante OK', nifCaisse: '', softwareVersion: '1.0',
          // Marquage explicite : jamais confondable avec un ticket de vente.
          testMarker: 'TEST — SANS VALEUR FISCALE',
        },
        { allowBrowserFallback: false },
      );
      setPrintResult(ok
        ? { ok: true, msg: 'Impression envoyée et confirmée par Windows.' }
        : { ok: false, msg: 'Échec : Windows/l’imprimante n’a pas confirmé l’impression.' });
    } catch (e) {
      setPrintResult({ ok: false, msg: `Erreur : ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setPrintBusy(false);
    }
  };

  const runTestDrawer = async () => {
    setDrawerBusy(true);
    setDrawerResult(null);
    try {
      const ok = await peripheralBridge.openCashDrawer();
      setDrawerResult(ok
        ? { ok: true, msg: `Commande d’ouverture envoyée au tiroir (voie : ${peripheralBridge.lastDrawerTimings?.path ?? '?'}, ${peripheralBridge.lastDrawerTimings?.ms ?? '?'} ms).` }
        : { ok: false, msg: peripheralBridge.lastDrawerError || 'Échec : aucun tiroir n’a pu être ouvert (imprimante/tiroir ?).' });
    } catch (e) {
      setDrawerResult({ ok: false, msg: `Erreur : ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setDrawerBusy(false);
    }
  };

  const printer = status.printer;
  const drawer = status.cashDrawer;

  return (
    <div className="min-h-screen bg-pos-bg text-pos-text p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/pos')} className="p-2 rounded-xl hover:bg-pos-subtle" title="Retour">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Printer size={22} /> Imprimante &amp; tiroir-caisse
          </h1>
        </div>

        {!isDesktop && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 px-4 py-3 text-sm">
            Diagnostic disponible uniquement dans l’application desktop (Windows).
          </div>
        )}

        {isDesktop && (
          <div className="space-y-5">
            {/* Statut */}
            <div className="rounded-2xl border border-pos-border/30 p-4 bg-white/5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-pos-muted mb-3">Statut</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-pos-muted">Imprimante :</span> <span className="font-semibold">{printer.name || '—'}</span></div>
                <div><span className="text-pos-muted">Type :</span> <span className="font-mono text-xs">{printer.type}</span></div>
                <div><span className="text-pos-muted">Connectée :</span> {printer.connected ? <span className="text-emerald-400 font-semibold">oui</span> : <span className="text-amber-400 font-semibold">non</span>}</div>
                <div><span className="text-pos-muted">Tiroir :</span> <span className="font-mono text-xs">{drawer.type}</span> {drawer.connected ? '✓' : ''}</div>
              </div>
            </div>

            {/* Pilote & mode réel (Get-Printer) — clé du diagnostic TSP143 */}
            <div className="rounded-2xl border border-pos-border/30 p-4 bg-white/5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-pos-muted mb-3">Pilote &amp; mode réel</h2>
              {peripheralBridge.printerInfo ? (
                <div className="space-y-1.5 text-sm">
                  <div><span className="text-pos-muted">Driver Windows :</span> <span className="font-mono text-xs">{peripheralBridge.printerInfo.driverName || '—'}</span></div>
                  <div><span className="text-pos-muted">Port :</span> <span className="font-mono text-xs">{peripheralBridge.printerInfo.portName || '—'}</span></div>
                  <div><span className="text-pos-muted">Mode déduit :</span> <span className="font-semibold">{printerModeLabel(peripheralBridge.printerInfo.mode)}</span></div>
                  {peripheralBridge.printerInfo.mode === 'star-raster' && (
                    <p className="text-xs text-amber-300 mt-1">
                      TSP100/TSP143 futurePRNT : imprimante raster pilotée par Windows — les commandes
                      ESC/POS brutes (tiroir/coupe RAW) ne sont PAS interprétées par ce firmware.
                      Utiliser la stratégie « file tiroir » ci-dessous.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-pos-muted italic">Driver non lu (rafraîchir, ou hors Windows).</p>
              )}
            </div>

            {/* Sélection imprimante */}
            <div className="rounded-2xl border border-pos-border/30 p-4 bg-white/5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-pos-muted">Imprimantes Windows</h2>
                <button onClick={refresh} disabled={loadingList} className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-pos-subtle">
                  {loadingList ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rafraîchir
                </button>
              </div>
              {printers.length === 0 ? (
                <p className="text-sm text-pos-muted italic">Aucune imprimante détectée par Windows.</p>
              ) : (
                <div className="space-y-1.5">
                  {printers.map((name) => (
                    <button
                      key={name}
                      onClick={() => choosePrinter(name)}
                      className={`w-full text-left px-3 py-2 rounded-xl border text-sm flex items-center justify-between ${
                        selected === name || printer.name === name
                          ? 'border-emerald-400 bg-emerald-400/10 font-semibold'
                          : 'border-pos-border/30 hover:bg-pos-subtle'
                      }`}
                    >
                      <span className="truncate">{name}</span>
                      {(selected === name || printer.name === name) && <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Largeur papier (58 / 80 mm) */}
            <div className="rounded-2xl border border-pos-border/30 p-4 bg-white/5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-pos-muted mb-3">Largeur papier</h2>
              <div className="flex gap-3">
                {([58, 80] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => { setPaperWidthMm(w); setPaperWidth(w); }}
                    className={`px-4 py-2.5 rounded-xl border text-sm font-semibold ${
                      paperWidth === w
                        ? 'border-emerald-400 bg-emerald-400/10'
                        : 'border-pos-border/30 hover:bg-pos-subtle'
                    }`}
                  >
                    {w} mm
                  </button>
                ))}
              </div>
              <p className="text-xs text-pos-muted mt-2">
                Appliquée à tous les tickets de cette caisse (mise en page et colonnes ESC/POS).
              </p>
            </div>

            {/* Stratégie tiroir-caisse */}
            <div className="rounded-2xl border border-pos-border/30 p-4 bg-white/5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-pos-muted mb-3">Ouverture du tiroir</h2>
              <div className="space-y-1.5">
                {(
                  [
                    ['auto', 'Automatique (selon le driver détecté) — recommandé'],
                    ['raw_escpos', 'Kick ESC/POS brut (imprimantes ESC/POS uniquement)'],
                    ['drawer_queue', 'File Windows dédiée au tiroir (TSP100/TSP143 futurePRNT)'],
                  ] as Array<[DrawerStrategy, string]>
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="drawer-strategy"
                      checked={drawerStrategy === value}
                      onChange={() => { setDrawerStrategy(value); setDrawerStrategyState(value); }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <label className="text-xs text-pos-muted block mb-1">
                  File Windows dédiée au tiroir (2ᵉ file sur le même port, driver configuré
                  « Peripheral Unit = Cash Drawer, ouverture en début de document »)
                </label>
                <input
                  type="text"
                  value={drawerQueue}
                  onChange={(e) => { setDrawerQueueState(e.target.value); setDrawerQueueName(e.target.value || null); }}
                  placeholder="ex. Star TSP143 (Tiroir)"
                  className="w-full px-3 py-2 rounded-xl bg-black/20 border border-pos-border/30 text-sm font-mono"
                />
              </div>
              <p className="text-xs text-pos-muted mt-2">
                Une impulsion = un job. Aucune commande brute n’est envoyée à une imprimante raster
                (protection anti « tiroir en boucle »). Un refus est expliqué, jamais silencieux.
              </p>
            </div>

            {/* Tests */}
            <div className="rounded-2xl border border-pos-border/30 p-4 bg-white/5 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-pos-muted">Tests</h2>
              <div className="flex flex-wrap gap-3">
                <button onClick={runTestPrint} disabled={printBusy} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-pos-accent text-white font-semibold hover:opacity-90 disabled:opacity-60">
                  {printBusy ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />} Impression test
                </button>
                <button onClick={runTestDrawer} disabled={drawerBusy} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-700 text-white font-semibold hover:opacity-90 disabled:opacity-60">
                  {drawerBusy ? <Loader2 size={16} className="animate-spin" /> : <Inbox size={16} />} Ouvrir le tiroir
                </button>
              </div>
              {printResult && (
                <div className={`flex items-start gap-2 text-sm ${printResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {printResult.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
                  <span>{printResult.msg}</span>
                </div>
              )}
              {drawerResult && (
                <div className={`flex items-start gap-2 text-sm ${drawerResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {drawerResult.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
                  <span>{drawerResult.msg}</span>
                </div>
              )}
              <p className="text-xs text-pos-muted">
                Le tiroir doit être branché sur le port RJ11 de l’imprimante. « Ouvrir le tiroir » envoie
                UNE impulsion via la stratégie ci-dessus — sans ticket, sans vente, sans boucle.
              </p>
            </div>

            {/* Dernière chaîne d'impression (trace terrain horodatée) */}
            <div className="rounded-2xl border border-pos-border/30 p-4 bg-white/5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-pos-muted mb-3">
                Dernière chaîne de vente (durées réelles)
              </h2>
              {(() => {
                const latest = printChainTrace.latest();
                if (!latest) {
                  return <p className="text-sm text-pos-muted italic">Aucune vente tracée sur cette caisse.</p>;
                }
                const rows = printChainTrace.durations(latest.saleId);
                return (
                  <div className="overflow-x-auto">
                    <p className="text-xs text-pos-muted mb-2 font-mono">{latest.saleId} — {new Date(latest.startedAt).toLocaleString('fr-FR')}</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-pos-muted text-left">
                          <th className="py-1 pr-3">Étape</th>
                          <th className="py-1 pr-3">T+ (ms)</th>
                          <th className="py-1 pr-3">Δ étape (ms)</th>
                          <th className="py-1">Détail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-t border-white/5">
                            <td className="py-1 pr-3 font-mono">{r.step}</td>
                            <td className="py-1 pr-3 tabular-nums">{r.atMs}</td>
                            <td className="py-1 pr-3 tabular-nums">{r.sincePrevMs}</td>
                            <td className="py-1 font-mono text-[10px] text-pos-muted break-all">
                              {r.meta ? JSON.stringify(r.meta) : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
