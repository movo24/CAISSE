import React, { useState, useEffect, useCallback } from 'react';
import { posEventBus, StockAlertPayload } from '../services/posEventBus';

/* ── Stock Alert Toast ──
   Appears in the bottom-left of the POS after a sale
   when products cross stock thresholds.
   Auto-dismisses after 8 seconds.
*/

const levelConfig = {
  out_of_stock: { bg: 'bg-red-600', border: 'border-red-700', label: 'RUPTURE', icon: '!!!' },
  critical: { bg: 'bg-red-500', border: 'border-red-600', label: 'CRITIQUE', icon: '!!' },
  alert: { bg: 'bg-amber-500', border: 'border-amber-600', label: 'BAS', icon: '!' },
};

export function StockAlertToast() {
  const [alerts, setAlerts] = useState<StockAlertPayload['alerts']>([]);
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => setAlerts([]), 400);
  }, []);

  useEffect(() => {
    const unsub = posEventBus.on('STOCK_ALERT', (payload) => {
      setAlerts(payload.alerts);
      setVisible(true);

      // Auto-dismiss after 8s
      const timer = setTimeout(dismiss, 8000);
      return () => clearTimeout(timer);
    });
    return unsub;
  }, [dismiss]);

  if (alerts.length === 0) return null;

  return (
    <div
      className={`fixed bottom-6 left-6 z-[999] max-w-sm transition-all duration-400 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
    >
      <div className="bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-2.5 bg-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-lg">&#9888;</span>
            <span className="text-white text-sm font-bold">
              Alerte stock ({alerts.length})
            </span>
          </div>
          <button
            onClick={dismiss}
            className="text-gray-400 hover:text-white text-lg leading-none px-1"
          >
            &#10005;
          </button>
        </div>

        {/* Alert list */}
        <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
          {alerts.map((a) => {
            const config = levelConfig[a.level];
            return (
              <div
                key={a.productId}
                className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-800/50"
              >
                <span
                  className={`${config.bg} text-white text-[10px] font-black px-2 py-1 rounded-lg border ${config.border} shrink-0`}
                >
                  {config.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold truncate">
                    {a.productName}
                  </p>
                  <p className="text-gray-400 text-[11px]">
                    {a.remainingStock === 0
                      ? 'Plus de stock !'
                      : `${a.remainingStock} unite${a.remainingStock > 1 ? 's' : ''} restante${a.remainingStock > 1 ? 's' : ''}`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
