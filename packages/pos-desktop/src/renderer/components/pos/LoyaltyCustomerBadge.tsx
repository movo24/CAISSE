import React from 'react';
import { User, Sparkles, Clock, X } from 'lucide-react';

export interface LoyaltyScanResult {
  customerFound: true;
  customerId: string;
  firstName: string;
  availableCoupon: {
    id: string;
    type: string;
    discountPercent: number;
  } | null;
  nextReward: {
    eligible: boolean;
    discountPercent?: number;
    daysRemaining?: number;
    nextAvailableAt?: string;
    reason?: string;
  };
  message: string;
}

interface Props {
  scan: LoyaltyScanResult;
  onApplyCoupon: () => void;
  onClear: () => void;
}

/**
 * Badge displayed after a successful loyalty QR scan.
 * Shows customer first name + available coupon (if any) + CTA.
 */
export function LoyaltyCustomerBadge({ scan, onApplyCoupon, onClear }: Props) {
  const hasCoupon = !!scan.availableCoupon;

  return (
    <div
      className="rounded-2xl p-4 mb-3 relative"
      style={{
        background: hasCoupon
          ? 'linear-gradient(120deg, rgba(255,107,157,0.10), rgba(99,102,241,0.10), rgba(74,222,128,0.10))'
          : 'rgba(99,102,241,0.06)',
        border: '1px solid rgba(99,102,241,0.20)',
      }}
    >
      <button
        onClick={onClear}
        className="absolute top-2 right-2 p-1 rounded-full hover:bg-black/5"
        title="Retirer le client"
      >
        <X size={14} />
      </button>

      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{
            background:
              'linear-gradient(120deg, #FF6B9D, #C471ED, #6366F1, #12D8FA)',
          }}
        >
          <User size={18} className="text-white" />
        </div>

        <div className="flex-1">
          <p className="font-semibold text-sm">{scan.firstName}</p>
          <p className="text-xs text-pos-muted">
            The Wesley Club · Client reconnu
          </p>
        </div>

        {hasCoupon ? (
          <button
            onClick={onApplyCoupon}
            className="px-4 py-2 rounded-xl font-bold text-sm text-white shadow-lg flex items-center gap-1.5"
            style={{
              background:
                'linear-gradient(120deg, #FF6B9D, #C471ED, #6366F1)',
              boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
            }}
          >
            <Sparkles size={14} />
            Appliquer −{scan.availableCoupon!.discountPercent}%
          </button>
        ) : (
          <div className="text-right">
            <div className="flex items-center gap-1 text-xs text-pos-muted">
              <Clock size={11} />
              <span>
                {scan.nextReward.eligible
                  ? 'Avantage à venir'
                  : `Dans ${scan.nextReward.daysRemaining}j`}
              </span>
            </div>
          </div>
        )}
      </div>

      {hasCoupon && (
        <p className="text-[11px] mt-2 text-pos-muted">
          Coupon {scan.availableCoupon!.type === 'WELCOME'
            ? 'de bienvenue'
            : 'fidélité'} · à valider après ajout du ticket
        </p>
      )}
    </div>
  );
}
