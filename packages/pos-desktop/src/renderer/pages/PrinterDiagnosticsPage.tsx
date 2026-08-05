import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Printer, Inbox, RefreshCw, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';
import { peripheralBridge, getPaperWidthMm, setPaperWidthMm, type PaperWidthMm } from '../services/peripheralBridge';
import {
  describeQueueState,
  getDrawerQueueName,
  getDrawerStrategy,
  getForcePageSize,
  printerModeLabel,
  resolveDrawerQueue,
  setDrawerQueueName,
  setDrawerStrategy,
  setForcePageSize,
  type DrawerStrategy,
  type WindowsQueueState,
} from '../services/drawerStrategy';
import { printChainTrace } from '../services/printChainTrace';
import { buildTestTicket } from '../services/testTicket';
import { resolveReceiptLogo } from '../services/brandLogo';
import { makeTicketQrDataUrl } from '../services/ticketQr';

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
  const [queues, setQueues] = useState<WindowsQueueState[]>([]);
  /** Dernier diagnostic d'impression, affiché à l'écran (pas besoin de DevTools). */
  const [printDiag, setPrintDiag] = useState<Record<string, unknown> | null>(null);
  /** Garde synchrone anti-double-clic (un état React arrive trop tard). */
  const printBusyRef = useRef(false);
  /** Aperçu de la fenêtre réellement envoyée à l'impression. */
  const [printPreview, setPrintPreview] = useState<string | null>(null);
  const [forcePageSize, setForcePageSizeState] = useState<boolean>(getForcePageSize());

  const isDesktop = typeof window !== 'undefined' && (window as any).electronAPI?.getPrinters;

  const refresh = async () => {
    setLoadingList(true);
    try {
      const list: string[] = (await (window as any).electronAPI?.getPrinters?.()) || [];
      setPrinters(list);
    } catch {
      setPrinters([]);
    }
    // État RÉEL des files Windows : c'est lui qui explique un job « soumis »
    // qui ne sort pas physiquement (hors connexion, suspendue, jobs empilés).
    try {
      const res = await (window as any).electronAPI?.listQueues?.();
      setQueues(res?.ok && Array.isArray(res.queues) ? res.queues : []);
    } catch {
      setQueues([]);
    }
    setStatus({ ...peripheralBridge.status });
    setLoadingList(false);
  };

  /** État Windows d'une file nommée (null si inconnue/non lue). */
  const queueOf = (name: string | null | undefined): WindowsQueueState | null =>
    (name && queues.find((q) => q.name === name)) || null;

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
    // Garde SYNCHRONE anti-double-clic : `printBusy` est un état React, donc
    // appliqué au re-render suivant — deux clics rapprochés passeraient au
    // travers et enverraient DEUX jobs à l'imprimante.
    if (printBusyRef.current) return;
    printBusyRef.current = true;
    setPrintBusy(true);
    setPrintResult(null);
    try {
      // Ticket de test COMPLET : logo, 4 articles (quantités, remise, 2 taux de
      // TVA), totaux, ventilation TVA, espèces/rendu, QR. Même chemin exact
      // qu'une vente réelle — c'est ce qui rend la mesure comparable.
      const logo = resolveReceiptLogo(null);
      const qr = await makeTicketQrDataUrl('https://thewesleys.fr/ticket/TEST');
      const ticket = buildTestTicket(logo, qr, getPaperWidthMm());
      console.info(
        '[PERIPH] Test print — ticket construit',
        JSON.stringify({ logo: !!logo, qr: !!qr, items: ticket.items.length, total: ticket.total }),
      );
      const ok = await peripheralBridge.printTicket(ticket, { allowBrowserFallback: false });
      // HONNÊTETÉ : Electron confirme la REMISE AU SPOULEUR, jamais la sortie
      // physique du papier. On ne dit donc PAS « ticket imprimé ». Si la file
      // est hors connexion/suspendue, on l'annonce ici plutôt que de laisser
      // l'opérateur chercher un papier qui ne sortira pas.
      const blocked = describeQueueState(queueOf(peripheralBridge.status.printer.name));
      setPrintResult(ok
        ? {
            ok: !blocked,
            msg: blocked
              ? `Travail envoyé à la file Windows « ${peripheralBridge.status.printer.name} », mais elle ne peut pas imprimer : ${blocked}`
              : `Travail envoyé à la file Windows « ${peripheralBridge.status.printer.name} ». `
                + 'Vérifiez la sortie papier : Windows ne confirme pas l’impression physique.',
          }
        : { ok: false, msg: 'Échec : Windows a refusé le travail d’impression (aucun job créé).' });
    } catch (e) {
      console.error('[PERIPH] Test print — exception', e);
      setPrintResult({ ok: false, msg: `Erreur : ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      // Diagnostic lisible À L'ÉCRAN : évite d'avoir à ouvrir DevTools sur la
      // caisse pour lire `htmlBytes` (le chiffre qui dit si le ticket est vide).
      setPrintDiag(peripheralBridge.lastPrintTimings as Record<string, unknown> | null);
      setPrintPreview(peripheralBridge.lastPrintPreview);
      printBusyRef.current = false;
      setPrintBusy(false);
    }
  };

  /**
   * HTML MINIMAL par le chemin d'impression EXACT du ticket. Sépare deux causes
   * qu'on ne pouvait pas distinguer : pipeline d'impression cassé, ou ressources
   * du ticket (logo, QR, polices) qui empêchent le rendu.
   */
  const runMinimalPrint = async () => {
    if (printBusyRef.current) return;
    printBusyRef.current = true;
    setPrintBusy(true);
    setPrintResult(null);
    try {
      const html =
        '<!doctype html><html><head><meta charset="utf-8">' +
        '<style>html{margin:0;padding:0}body{font-family:monospace;font-size:14px;width:72mm;margin:3mm;color:#000}</style>' +
        '</head><body><h1>TEST</h1><p>Impression minimale — aucune image, aucune police externe.</p>' +
        '<p>Si CECI sort et pas le ticket, ce sont les ressources du ticket.</p></body></html>';
      const ok = await peripheralBridge.printRawHtml(html);
      setPrintResult(
        ok
          ? { ok: true, msg: 'HTML minimal envoyé à la file Windows. Le papier doit porter « TEST » sur ~3 cm.' }
          : { ok: false, msg: 'Échec : Windows a refusé le travail d’impression minimal.' },
      );
    } catch (e) {
      console.error('[PERIPH] Test HTML minimal — exception', e);
      setPrintResult({ ok: false, msg: `Erreur : ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setPrintDiag(peripheralBridge.lastPrintTimings as Record<string, unknown> | null);
      setPrintPreview(peripheralBridge.lastPrintPreview);
      printBusyRef.current = false;
      setPrintBusy(false);
    }
  };

  const runTestDrawer = async () => {
    setDrawerBusy(true);
    setDrawerResult(null);
    try {
      const ok = await peripheralBridge.openCashDrawer();
      setDrawerResult(ok
        ? peripheralBridge.lastDrawerTimings?.path === 'delegated'
          ? { ok: true, msg: 'Ouverture déléguée au pilote Star : le tiroir s’ouvre à l’impression du ticket. Aucune commande envoyée par la caisse.' }
          : { ok: true, msg: `Commande d’ouverture envoyée au tiroir (voie : ${peripheralBridge.lastDrawerTimings?.path ?? '?'}, ${peripheralBridge.lastDrawerTimings?.ms ?? '?'} ms).` }
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

              {/* Avertissement de configuration — jamais silencieux. */}
              {peripheralBridge.printerWarning && (
                <p className="text-xs text-amber-300 mt-3">{peripheralBridge.printerWarning}</p>
              )}

              {/* État Windows RÉEL de la file tickets : explique un job soumis
                  qui ne produit aucun papier. */}
              {(() => {
                const q = queueOf(printer.name);
                if (!q) return null;
                const blocked = describeQueueState(q);
                return (
                  <p className={`text-xs mt-2 ${blocked ? 'text-red-400' : 'text-emerald-400'}`}>
                    File tickets « {q.name} » — statut Windows : {q.status}
                    {q.workOffline ? ' (hors connexion)' : ''}, {q.queuedJobs < 0 ? '?' : q.queuedJobs} job(s) en attente.
                    {blocked ? ` ${blocked}` : ' Prête.'}
                  </p>
                );
              })()}
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

              {/* Forçage du format de page — DÉSACTIVÉ par défaut : la page de
                  test Windows sort entière, donc le formulaire rouleau du pilote
                  est bon et sa longueur suit le contenu. À n'activer que sur un
                  poste dont le formulaire serait mal réglé. */}
              <label className="flex items-start gap-2 text-sm cursor-pointer mt-3">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={forcePageSize}
                  onChange={(e) => { setForcePageSize(e.target.checked); setForcePageSizeState(e.target.checked); }}
                />
                <span>
                  Imposer le format de page à l’impression
                  <span className="block text-xs text-pos-muted">
                    Par défaut le formulaire rouleau du pilote décide (recommandé). N’activer que si
                    le ticket sort tronqué : un format absent des formulaires du pilote peut être refusé.
                  </span>
                </span>
              </label>
            </div>

            {/* Stratégie tiroir-caisse */}
            <div className="rounded-2xl border border-pos-border/30 p-4 bg-white/5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-pos-muted mb-3">Ouverture du tiroir</h2>
              <div className="space-y-1.5">
                {(
                  [
                    ['auto', 'Automatique (selon le driver détecté) — recommandé'],
                    ['raw_escpos', 'Kick ESC/POS brut (imprimantes ESC/POS uniquement)'],
                    ['driver', 'Géré par le pilote Star (futurePRNT ouvre le tiroir à l’impression)'],
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
                  File Windows dédiée au tiroir (2ᵉ file sur le même port Star, driver configuré
                  « Peripheral Unit = Cash Drawer, ouverture en début de document »)
                </label>
                {/* Sélecteur sur les files RÉELLES : une saisie libre laissait
                    passer une faute de frappe → Windows refuse en silence et le
                    tiroir reste muet sans explication. */}
                <select
                  value={queues.some((q) => q.name === drawerQueue) ? drawerQueue : ''}
                  onChange={(e) => { setDrawerQueueState(e.target.value); setDrawerQueueName(e.target.value || null); }}
                  className="w-full px-3 py-2 rounded-xl bg-black/20 border border-pos-border/30 text-sm font-mono"
                >
                  <option value="">— Aucune file tiroir sélectionnée —</option>
                  {queues.map((q) => (
                    <option key={q.name} value={q.name}>{q.name}</option>
                  ))}
                </select>

                {/* File mémorisée qui n'existe plus : dit précisément le cas. */}
                {(() => {
                  const res = resolveDrawerQueue(drawerQueue, queues.map((q) => q.name));
                  if (res.ok) {
                    const blocked = describeQueueState(queueOf(res.queueName));
                    return blocked ? (
                      <p className="text-xs text-amber-300 mt-2">File tiroir « {res.queueName} » : {blocked}</p>
                    ) : (
                      <p className="text-xs text-emerald-400 mt-2">File tiroir « {res.queueName} » prête.</p>
                    );
                  }
                  if (res.reason === 'vanished') {
                    return <p className="text-xs text-red-400 mt-2">{res.message}</p>;
                  }
                  return queues.length > 0 ? (
                    <p className="text-xs text-amber-300 mt-2">{res.message}</p>
                  ) : null;
                })()}
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
                <button onClick={runMinimalPrint} disabled={printBusy} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:opacity-90 disabled:opacity-60">
                  {printBusy ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />} Test HTML minimal
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

              {/* Diagnostic d'impression LISIBLE SANS DEVTOOLS. `htmlBytes` dit
                  si le ticket envoyé était réellement rempli ou quasi vide. */}
              {printDiag && (
                <div className="rounded-xl bg-black/20 border border-pos-border/30 p-3 mt-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-pos-muted mb-2">
                    Diagnostic de la dernière impression
                  </p>
                  {(() => {
                    const textLen = printDiag.textLen;
                    if (textLen !== null && textLen !== undefined && Number(textLen) === 0) {
                      return (
                        <p className="text-xs mb-2 text-red-400">
                          Le document rendu ne contient AUCUN texte (textLen = 0) : la fenêtre
                          d’impression n’a rien peint. C’est la cause du papier coupé à 1 mm.
                        </p>
                      );
                    }
                    const bytes = Number(printDiag.htmlBytes ?? 0);
                    const verdict =
                      bytes < 2000
                        ? { cls: 'text-red-400', txt: `Ticket QUASI VIDE (${bytes} octets) — le document généré est incomplet.` }
                        : bytes >= 50000
                          ? { cls: 'text-emerald-400', txt: `Ticket COMPLET (${bytes.toLocaleString('fr-FR')} octets, logo inclus) — le problème est en aval : pilote, format papier ou marges.` }
                          : { cls: 'text-amber-300', txt: `Ticket PARTIEL (${bytes.toLocaleString('fr-FR')} octets) — probablement sans logo ni QR.` };
                    return <p className={`text-xs mb-2 ${verdict.cls}`}>{verdict.txt}</p>;
                  })()}
                  <table className="w-full text-[11px]">
                    <tbody>
                      {Object.entries(printDiag).map(([k, v]) => (
                        <tr key={k} className="border-t border-white/5">
                          <td className="py-0.5 pr-3 font-mono text-pos-muted">{k}</td>
                          <td className="py-0.5 font-mono break-all">{v === null ? '(défaut pilote)' : String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* APERÇU de la fenêtre EXACTE partie à l'impression, capturé
                      au moment du lancement. Si cette image montre le ticket,
                      le rendu est bon et le problème est purement pilote. */}
                  <div className="mt-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-pos-muted mb-2">
                      Aperçu de la fenêtre envoyée à l’impression
                    </p>
                    {printPreview ? (
                      <>
                        <img
                          src={printPreview}
                          alt="Aperçu du document envoyé à l’imprimante"
                          className="bg-white rounded-lg border border-pos-border/30 max-w-[300px]"
                        />
                        <p className="text-xs text-pos-muted mt-1">
                          Si le ticket est lisible ci-dessus mais que le papier sort blanc, le
                          rendu est correct : la cause est le pilote ou le format papier.
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-amber-300">
                        Aperçu non capturé (capturePage indisponible sur cette fenêtre) — l’absence
                        d’aperçu ne signifie PAS que le ticket était vide.
                      </p>
                    )}
                  </div>
                </div>
              )}
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
