/**
 * PrinterSettings — Bluetooth thermal printer pairing & cash drawer management UI
 *
 * Accessible via settings icon on POS toolbar.
 * Handles: pairing, test print, test drawer kick, status display.
 */

import React, { useState } from 'react';
import {
  Printer, Bluetooth, BluetoothSearching, Check, X, AlertTriangle,
  Zap, TestTube, Unplug, Trash2, Loader2, DoorOpen,
} from 'lucide-react';
import { useBluetoothPrinter, BTPrinterStatus } from '../../hooks/useBluetoothPrinter';
import { usePOSStore } from '../../stores/posStore';

interface PrinterSettingsProps {
  open: boolean;
  onClose: () => void;
}

const statusConfig: Record<BTPrinterStatus, { label: string; color: string; icon: React.ReactNode }> = {
  disconnected: { label: 'Deconnectee', color: 'text-gray-400', icon: <Unplug className="w-4 h-4" /> },
  searching: { label: 'Recherche...', color: 'text-blue-400', icon: <BluetoothSearching className="w-4 h-4 animate-pulse" /> },
  connecting: { label: 'Connexion...', color: 'text-amber-400', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
  connected: { label: 'Connectee', color: 'text-emerald-400', icon: <Check className="w-4 h-4" /> },
  printing: { label: 'Impression...', color: 'text-blue-400', icon: <Loader2 className="w-4 h-4 animate-spin" /> },
  error: { label: 'Erreur', color: 'text-red-400', icon: <AlertTriangle className="w-4 h-4" /> },
};

export function PrinterSettings({ open, onClose }: PrinterSettingsProps) {
  const bt = useBluetoothPrinter();
  const [testResult, setTestResult] = useState<'idle' | 'printing' | 'success' | 'fail'>('idle');
  const [drawerResult, setDrawerResult] = useState<'idle' | 'sending' | 'success' | 'fail'>('idle');

  if (!open) return null;

  const stCfg = statusConfig[bt.status];

  const handleTestPrint = async () => {
    setTestResult('printing');
    const ok = await bt.printTest();
    setTestResult(ok ? 'success' : 'fail');
    setTimeout(() => setTestResult('idle'), 3000);
  };

  const handleTestDrawer = async () => {
    setDrawerResult('sending');
    const ok = await bt.openCashDrawer();
    // Ouverture manuelle du tiroir = fait sensible signé (session courante).
    if (ok) usePOSStore.getState().logScoreEvent('CASH_DRAWER_OPENED_MANUALLY', 'Ouverture manuelle du tiroir');
    setDrawerResult(ok ? 'success' : 'fail');
    setTimeout(() => setDrawerResult('idle'), 3000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-gray-900 rounded-2xl border border-white/10 w-full max-w-md overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Printer className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">Imprimante & Tiroir</h2>
              <p className="text-white/40 text-xs">Configuration Bluetooth</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Bluetooth support check */}
          {!bt.isSupported && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 text-red-300 text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>Bluetooth non disponible. Utilisez Chrome en HTTPS.</span>
              </div>
            </div>
          )}

          {/* Error display */}
          {bt.error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
              <p className="text-red-300 text-sm">{bt.error}</p>
            </div>
          )}

          {/* Printer status card */}
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">Imprimante</span>
              <div className={`flex items-center gap-1.5 text-xs font-medium ${stCfg.color}`}>
                {stCfg.icon}
                {stCfg.label}
              </div>
            </div>

            {bt.printer ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <Bluetooth className="w-6 h-6 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold truncate">{bt.printer.name}</p>
                    <p className="text-white/40 text-xs">ID: {bt.printer.id.slice(0, 12)}...</p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleTestPrint}
                    disabled={bt.status !== 'connected' || testResult === 'printing'}
                    className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {testResult === 'printing' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                     testResult === 'success' ? <Check className="w-4 h-4 text-emerald-400" /> :
                     testResult === 'fail' ? <X className="w-4 h-4 text-red-400" /> :
                     <TestTube className="w-4 h-4" />}
                    Test impression
                  </button>
                  <button
                    onClick={handleTestDrawer}
                    disabled={bt.status !== 'connected' || drawerResult === 'sending'}
                    className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm font-medium hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {drawerResult === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                     drawerResult === 'success' ? <Check className="w-4 h-4 text-emerald-400" /> :
                     drawerResult === 'fail' ? <X className="w-4 h-4 text-red-400" /> :
                     <DoorOpen className="w-4 h-4" />}
                    Ouvrir tiroir
                  </button>
                </div>

                {/* Disconnect / Remove */}
                <div className="flex gap-2 pt-1">
                  {bt.status === 'connected' ? (
                    <button onClick={bt.disconnect}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm hover:bg-white/10 transition-all">
                      <Unplug className="w-4 h-4" /> Deconnecter
                    </button>
                  ) : (
                    <button onClick={bt.startPairing}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-300 text-sm hover:bg-blue-600/30 transition-all">
                      <Bluetooth className="w-4 h-4" /> Reconnecter
                    </button>
                  )}
                  <button onClick={bt.removePrinter}
                    className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm hover:bg-red-500/20 transition-all">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              /* No printer paired */
              <button
                onClick={bt.startPairing}
                disabled={!bt.isSupported || bt.status === 'searching'}
                className="w-full flex items-center justify-center gap-3 px-4 py-4 rounded-xl border-2 border-dashed border-white/20 text-white/60 hover:border-blue-500/40 hover:text-blue-300 hover:bg-blue-500/5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {bt.status === 'searching' ? (
                  <><BluetoothSearching className="w-5 h-5 animate-pulse" /> Recherche en cours...</>
                ) : (
                  <><Bluetooth className="w-5 h-5" /> Appairer une imprimante</>
                )}
              </button>
            )}
          </div>

          {/* Cash drawer info */}
          <div className="bg-white/5 rounded-xl border border-white/10 p-4">
            <div className="flex items-center gap-2 mb-2">
              <DoorOpen className="w-4 h-4 text-amber-400" />
              <span className="text-white/60 text-xs font-semibold uppercase tracking-wider">Tiroir-caisse</span>
            </div>
            <p className="text-white/40 text-xs leading-relaxed">
              Le tiroir-caisse s'ouvre automatiquement apres chaque paiement en especes via la commande ESC/POS
              envoyee a l'imprimante Bluetooth connectee.
            </p>
            {bt.printer && bt.status === 'connected' && (
              <div className="mt-2 flex items-center gap-1.5 text-emerald-400 text-xs">
                <Zap className="w-3 h-3" />
                <span>Tiroir actif via {bt.printer.name}</span>
              </div>
            )}
          </div>

          {/* Help */}
          <div className="text-white/30 text-xs space-y-1 px-1">
            <p>• Allumez l'imprimante et activez le Bluetooth</p>
            <p>• Compatible : imprimantes thermiques 58/80mm ESC/POS BLE</p>
            <p>• Le tiroir-caisse se connecte via le port RJ11 de l'imprimante</p>
          </div>
        </div>
      </div>
    </div>
  );
}
