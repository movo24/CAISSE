import React, { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PaymentTerminal {
  id: string;
  storeId: string;
  provider: string;
  deviceType: string;
  label: string;
  serialNumber: string | null;
  stripeReaderId: string | null;
  stripeLocationId: string | null;
  registrationCode: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'ERROR';
  lastSeenAt: string | null;
  batteryLevel: number | null;
  firmwareVersion: string | null;
  isActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Erreur réseau' }));
    throw new Error(err.message || `Erreur ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function TerminalsPage() {
  const [terminals, setTerminals] = useState<PaymentTerminal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state
  const [formLabel, setFormLabel] = useState('Terminal Caisse 1');
  const [formSerial, setFormSerial] = useState('');
  const [formRegCode, setFormRegCode] = useState('');
  const [formDeviceType, setFormDeviceType] = useState('WISEPAD_3');
  const [formSubmitting, setFormSubmitting] = useState(false);

  const fetchTerminals = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/terminals');
      setTerminals(Array.isArray(data) ? data : data.terminals || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTerminals();
  }, [fetchTerminals]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setError(null);
    try {
      await apiFetch('/terminals', {
        method: 'POST',
        body: JSON.stringify({
          label: formLabel,
          deviceType: formDeviceType,
          serialNumber: formSerial || undefined,
          registrationCode: formRegCode || undefined,
        }),
      });
      setShowAddForm(false);
      setFormLabel('Terminal Caisse 1');
      setFormSerial('');
      setFormRegCode('');
      await fetchTerminals();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleToggleActive = async (terminal: PaymentTerminal) => {
    try {
      await apiFetch(`/terminals/${terminal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !terminal.isActive }),
      });
      await fetchTerminals();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const getStatusBadge = (status: string, isActive: boolean) => {
    if (!isActive) return { color: 'bg-gray-100 text-gray-600', text: 'Désactivé' };
    switch (status) {
      case 'ONLINE':
        return { color: 'bg-green-100 text-green-700', text: 'En ligne' };
      case 'ERROR':
        return { color: 'bg-red-100 text-red-700', text: 'Erreur' };
      default:
        return { color: 'bg-gray-100 text-gray-500', text: 'Hors ligne' };
    }
  };

  const getDeviceLabel = (type: string) => {
    switch (type) {
      case 'WISEPAD_3':
        return 'WisePad 3';
      case 'STRIPE_M2':
        return 'Stripe M2';
      case 'STRIPE_S700':
        return 'Stripe S700';
      default:
        return type;
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return 'Jamais';
    return new Date(date).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div style={{ padding: '24px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Terminaux de paiement</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0', fontSize: '14px' }}>
            Gérez vos lecteurs de carte Stripe Terminal
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          style={{
            padding: '10px 20px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: '14px',
          }}
        >
          {showAddForm ? 'Annuler' : '+ Ajouter un terminal'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', backgroundColor: '#fef2f2', color: '#dc2626', borderRadius: '8px', marginBottom: '16px', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {/* Add terminal form */}
      {showAddForm && (
        <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginTop: 0, marginBottom: '16px' }}>
            Enregistrer un nouveau terminal
          </h3>
          <form onSubmit={handleAdd}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>
                  Nom du terminal
                </label>
                <input
                  type="text"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="Terminal Caisse 1"
                  required
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>
                  Type d'appareil
                </label>
                <select
                  value={formDeviceType}
                  onChange={(e) => setFormDeviceType(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
                >
                  <option value="WISEPAD_3">BBPOS WisePad 3</option>
                  <option value="STRIPE_M2">Stripe M2</option>
                  <option value="STRIPE_S700">Stripe S700</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>
                  Numéro de série (optionnel)
                </label>
                <input
                  type="text"
                  value={formSerial}
                  onChange={(e) => setFormSerial(e.target.value)}
                  placeholder="WPC32-XXXXXXXX"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '4px', color: '#374151' }}>
                  Code d'enregistrement Stripe (optionnel)
                </label>
                <input
                  type="text"
                  value={formRegCode}
                  onChange={(e) => setFormRegCode(e.target.value)}
                  placeholder="Affiché sur l'écran du terminal"
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={formSubmitting}
              style={{
                padding: '10px 24px',
                backgroundColor: formSubmitting ? '#9ca3af' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: formSubmitting ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                fontSize: '14px',
              }}
            >
              {formSubmitting ? 'Enregistrement...' : 'Enregistrer le terminal'}
            </button>
          </form>
        </div>
      )}

      {/* Terminal list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>
          Chargement des terminaux...
        </div>
      ) : terminals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', backgroundColor: '#f9fafb', borderRadius: '12px', border: '1px dashed #d1d5db' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📱</div>
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#374151', margin: '0 0 8px' }}>
            Aucun terminal enregistré
          </h3>
          <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>
            Ajoutez votre WisePad 3 pour accepter les paiements par carte.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {terminals.map((terminal) => {
            const badge = getStatusBadge(terminal.status, terminal.isActive);
            return (
              <div
                key={terminal.id}
                style={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  opacity: terminal.isActive ? 1 : 0.6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    backgroundColor: '#f3f4f6',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '20px',
                  }}>
                    💳
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 600, fontSize: '15px' }}>{terminal.label}</span>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        fontWeight: 500,
                        ...Object.fromEntries(badge.color.split(' ').map(c => {
                          if (c.startsWith('bg-')) return ['backgroundColor', c.includes('green') ? '#dcfce7' : c.includes('red') ? '#fef2f2' : '#f3f4f6'];
                          if (c.startsWith('text-')) return ['color', c.includes('green') ? '#15803d' : c.includes('red') ? '#dc2626' : '#6b7280'];
                          return ['', ''];
                        })),
                      }}>
                        {badge.text}
                      </span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                      {getDeviceLabel(terminal.deviceType)}
                      {terminal.serialNumber && ` · ${terminal.serialNumber}`}
                      {terminal.stripeReaderId && ` · ${terminal.stripeReaderId}`}
                    </div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>
                      Dernière connexion : {formatDate(terminal.lastSeenAt)}
                      {terminal.batteryLevel !== null && ` · Batterie : ${terminal.batteryLevel}%`}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleToggleActive(terminal)}
                    style={{
                      padding: '6px 14px',
                      backgroundColor: terminal.isActive ? '#fef2f2' : '#f0fdf4',
                      color: terminal.isActive ? '#dc2626' : '#15803d',
                      border: '1px solid',
                      borderColor: terminal.isActive ? '#fecaca' : '#bbf7d0',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 500,
                    }}
                  >
                    {terminal.isActive ? 'Désactiver' : 'Activer'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info box */}
      <div style={{ marginTop: '32px', padding: '16px 20px', backgroundColor: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
        <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#1e40af', margin: '0 0 8px' }}>
          Comment connecter un WisePad 3
        </h4>
        <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#1e40af', lineHeight: 1.8 }}>
          <li>Allumez le WisePad 3 et attendez l'affichage du code d'enregistrement</li>
          <li>Cliquez "Ajouter un terminal" et saisissez le code</li>
          <li>Le terminal sera automatiquement enregistré dans Stripe</li>
          <li>Dans l'app POS, le terminal apparaîtra dans la liste des lecteurs disponibles</li>
          <li>Testez avec un paiement de 0,50€</li>
        </ol>
      </div>
    </div>
  );
}
