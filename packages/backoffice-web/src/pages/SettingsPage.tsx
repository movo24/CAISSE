import React, { useState, useEffect } from 'react';
import { promosApi, employeesApi, stockApi } from '../services/api';

// ---------------------------------------------------------------------------
// Types locaux
// ---------------------------------------------------------------------------
interface PromoConfig {
  id: string;
  name: string;
  type: 'buy_x_get_discount' | 'percentage' | 'fixed_amount' | 'first_purchase';
  isActive: boolean;
  discountPercent: number;
  buyQuantity?: number;
  startDate: string;
  endDate: string;
}

interface StockThresholds {
  alertThreshold: number;
  criticalThreshold: number;
  autoOrderEnabled: boolean;
}

interface EmployeeRight {
  id: string;
  name: string;
  role: 'admin' | 'manager' | 'cashier';
  maxDiscountPercent: number;
  canVoidSale: boolean;
  canAccessReports: boolean;
  canManageStock: boolean;
}

interface DeviceConfig {
  id: string;
  name: string;
  type: 'printer' | 'scanner' | 'drawer';
  status: 'connected' | 'disconnected' | 'simulated';
  port: string;
}

const currencyOptions = [
  'EUR', 'GBP', 'USD', 'AED', 'JPY',
  'DZD', 'MAD', 'TND', 'SAR', 'QAR', 'BHD', 'CHF',
];

const vatRates = [
  { label: 'Taux normal', rate: 20 },
  { label: 'Taux intermediaire', rate: 10 },
  { label: 'Taux reduit', rate: 5.5 },
  { label: 'Taux super-reduit', rate: 2.1 },
];

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
type SettingsTab = 'store' | 'promos' | 'stock' | 'employees' | 'devices' | 'currency' | 'jackpot';

const tabs: { key: SettingsTab; label: string; icon: string }[] = [
  { key: 'store', label: 'Magasin', icon: '\u{1F3EA}' },
  { key: 'promos', label: 'Promotions', icon: '\u{1F3F7}' },
  { key: 'stock', label: 'Seuils stock', icon: '\u{1F4E6}' },
  { key: 'employees', label: 'Employes', icon: '\u{1F465}' },
  { key: 'devices', label: 'Peripheriques', icon: '\u{1F5A8}' },
  { key: 'currency', label: 'Devises', icon: '\u{1F4B1}' },
  { key: 'jackpot', label: 'Jackpot & Assets', icon: '\u{1F3B0}' },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <h3 className="font-semibold text-lg">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Toggle({
  enabled,
  onChange,
  label,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <div
        className={`w-11 h-6 rounded-full relative transition-colors ${
          enabled ? 'bg-blue-600' : 'bg-gray-300'
        }`}
        onClick={() => onChange(!enabled)}
      >
        <div
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </div>
      <span className="text-sm">{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Store settings tab
// ---------------------------------------------------------------------------
function StoreSettings() {
  const [storeName, setStoreName] = useState('Boutique Paris');
  const [address, setAddress] = useState('12 Rue du Commerce, 75015 Paris');
  const [timezone, setTimezone] = useState('Europe/Paris');
  const [receiptHeader, setReceiptHeader] = useState('Merci de votre visite !');
  const [receiptFooter, setReceiptFooter] = useState(
    'Echange possible sous 14 jours avec ticket.',
  );

  return (
    <div className="space-y-6">
      <SectionCard
        title="Informations du magasin"
        description="Parametres generaux de votre point de vente"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nom du magasin
            </label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fuseau horaire
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="Europe/Paris">Europe/Paris (CET)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
              <option value="Africa/Algiers">Africa/Algiers (CET)</option>
              <option value="Africa/Casablanca">Africa/Casablanca (WET)</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Adresse
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Ticket de caisse"
        description="Personnalisez l'en-tete et le pied de page de vos tickets"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              En-tete du ticket
            </label>
            <input
              type="text"
              value={receiptHeader}
              onChange={(e) => setReceiptHeader(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Pied de page du ticket
            </label>
            <input
              type="text"
              value={receiptFooter}
              onChange={(e) => setReceiptFooter(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="TVA / VAT"
        description="Taux de TVA appliques (France metropolitaine)"
      >
        <div className="space-y-3">
          {vatRates.map((vat) => (
            <div
              key={vat.label}
              className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
            >
              <span className="text-sm">{vat.label}</span>
              <span className="text-sm font-medium text-gray-700">
                {vat.rate}%
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Les taux de TVA sont definis au niveau national. Contactez le support
          pour les DOM-TOM ou autres juridictions.
        </p>
      </SectionCard>

      <div className="flex justify-end">
        <button className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
          Sauvegarder
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Promos settings tab
// ---------------------------------------------------------------------------
function PromosSettings() {
  const [promos, setPromos] = useState<PromoConfig[]>([]);

  useEffect(() => {
    promosApi.list().then((res) => {
      const data = res.data || [];
      setPromos(data.map((p: any) => ({
        id: p.id,
        name: p.name || '',
        type: p.type || 'percentage',
        isActive: p.isActive ?? true,
        discountPercent: p.discountPercent || 0,
        buyQuantity: p.buyQuantity,
        startDate: p.startDate || '',
        endDate: p.endDate || '',
      })));
    }).catch(() => {});
  }, []);

  const togglePromo = (id: string) => {
    setPromos(
      promos.map((p) =>
        p.id === id ? { ...p, isActive: !p.isActive } : p,
      ),
    );
  };

  const typeLabels: Record<PromoConfig['type'], string> = {
    buy_x_get_discount: 'Achetez X, remise',
    percentage: 'Pourcentage',
    fixed_amount: 'Montant fixe',
    first_purchase: '1er achat',
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Regles promotionnelles"
        description="Gerez vos promotions actives et planifiees"
      >
        <div className="space-y-4">
          {promos.map((promo) => (
            <div
              key={promo.id}
              className={`rounded-xl border p-4 transition-colors ${
                promo.isActive
                  ? 'border-blue-200 bg-blue-50/50'
                  : 'border-gray-200 bg-gray-50/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">{promo.name}</h4>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded-lg">
                      {typeLabels[promo.type]}
                    </span>
                    <span className="text-xs text-gray-500">
                      -{promo.discountPercent}%
                    </span>
                    {promo.buyQuantity && (
                      <span className="text-xs text-gray-500">
                        | Acheter {promo.buyQuantity}+1
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {promo.startDate} &rarr; {promo.endDate}
                  </p>
                </div>
                <Toggle
                  enabled={promo.isActive}
                  onChange={() => togglePromo(promo.id)}
                  label={promo.isActive ? 'Active' : 'Inactive'}
                />
              </div>
            </div>
          ))}
        </div>

        <button className="mt-4 w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
          + Ajouter une promotion
        </button>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock thresholds tab
// ---------------------------------------------------------------------------
function StockSettings() {
  const [thresholds, setThresholds] = useState<StockThresholds>({
    alertThreshold: 10,
    criticalThreshold: 5,
    autoOrderEnabled: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSaveThresholds = async () => {
    if (thresholds.criticalThreshold >= thresholds.alertThreshold) {
      setError('Le seuil critique doit etre inferieur au seuil d\'alerte');
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await stockApi.updateDefaultThresholds({
        alertThreshold: thresholds.alertThreshold,
        criticalThreshold: thresholds.criticalThreshold,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Seuils d'alerte stock"
        description="Definissez les seuils de notification pour la gestion des stocks"
      >
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Seuil d'alerte (orange)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                value={thresholds.alertThreshold}
                onChange={(e) =>
                  setThresholds({
                    ...thresholds,
                    alertThreshold: parseInt(e.target.value) || 0,
                  })
                }
                className="w-24 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">unites restantes</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Notification orange lorsque le stock passe sous ce seuil
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Seuil critique (rouge)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                value={thresholds.criticalThreshold}
                onChange={(e) =>
                  setThresholds({
                    ...thresholds,
                    criticalThreshold: parseInt(e.target.value) || 0,
                  })
                }
                className="w-24 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">unites restantes</span>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Alerte rouge urgente lorsque le stock passe sous ce seuil
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Commande automatique"
        description="Configurez le reapprovisionnement automatique (V2)"
      >
        <Toggle
          enabled={thresholds.autoOrderEnabled}
          onChange={(v) =>
            setThresholds({ ...thresholds, autoOrderEnabled: v })
          }
          label="Activer la commande automatique"
        />
        <p className="text-xs text-gray-400 mt-3">
          Fonctionnalite prevue pour la V2. La commande automatique generera un
          bon de commande fournisseur lorsqu'un produit passe sous le seuil
          critique.
        </p>
      </SectionCard>

      <SectionCard title="Visualisation des seuils">
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Critique</span>
              <span>Alerte</span>
              <span>Normal</span>
            </div>
            <div className="h-4 rounded-full overflow-hidden flex">
              <div
                className="bg-red-400"
                style={{
                  width: `${(thresholds.criticalThreshold / 50) * 100}%`,
                }}
              />
              <div
                className="bg-orange-400"
                style={{
                  width: `${((thresholds.alertThreshold - thresholds.criticalThreshold) / 50) * 100}%`,
                }}
              />
              <div className="bg-green-400 flex-1" />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>0</span>
              <span>{thresholds.criticalThreshold}</span>
              <span>{thresholds.alertThreshold}</span>
              <span>50+</span>
            </div>
          </div>
        </div>
      </SectionCard>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-700">
          Seuils mis a jour avec succes !
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSaveThresholds}
          disabled={saving}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Sauvegarde...' : 'Sauvegarder les seuils'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Employee rights tab
// ---------------------------------------------------------------------------
function EmployeesSettings() {
  const [employees, setEmployees] = useState<EmployeeRight[]>([]);

  useEffect(() => {
    employeesApi.list().then((res) => {
      const data = res.data || [];
      setEmployees(data.map((e: any) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        role: (e.role || 'cashier') as 'admin' | 'manager' | 'cashier',
        maxDiscountPercent: e.maxDiscountPercent ?? 5,
        canVoidSale: e.role === 'admin' || e.role === 'manager',
        canAccessReports: e.role === 'admin' || e.role === 'manager',
        canManageStock: e.role === 'admin' || e.role === 'manager',
      })));
    }).catch(() => {});
  }, []);

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-purple-100 text-purple-700',
      manager: 'bg-blue-100 text-blue-700',
      cashier: 'bg-gray-100 text-gray-700',
    };
    const labels: Record<string, string> = {
      admin: 'Admin',
      manager: 'Manager',
      cashier: 'Caissier',
    };
    return (
      <span
        className={`text-xs font-medium px-2.5 py-1 rounded-lg ${colors[role] || colors.cashier}`}
      >
        {labels[role] || role}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Droits des employes"
        description="Gerez les permissions et limites de chaque role"
      >
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  Employe
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  Role
                </th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">
                  Remise max
                </th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">
                  Annuler vente
                </th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">
                  Rapports
                </th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">
                  Gestion stock
                </th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-medium">{emp.name}</td>
                  <td className="px-4 py-3">{roleBadge(emp.role)}</td>
                  <td className="px-4 py-3 text-center">{emp.maxDiscountPercent}%</td>
                  <td className="px-4 py-3 text-center">
                    {emp.canVoidSale ? (
                      <span className="text-green-600">&#10003;</span>
                    ) : (
                      <span className="text-red-400">&#10007;</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {emp.canAccessReports ? (
                      <span className="text-green-600">&#10003;</span>
                    ) : (
                      <span className="text-red-400">&#10007;</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {emp.canManageStock ? (
                      <span className="text-green-600">&#10003;</span>
                    ) : (
                      <span className="text-red-400">&#10007;</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button className="mt-4 w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
          + Ajouter un employe
        </button>
      </SectionCard>

      <SectionCard
        title="QR Codes fidelite"
        description="Gestion des QR codes employes pour connexion rapide"
      >
        <div className="flex items-center gap-4">
          <button className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
            Regenerer tous les QR
          </button>
          <button className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-200 transition-colors">
            Imprimer les badges
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Chaque employe dispose d'un QR code unique pour se connecter
          rapidement a la caisse. La regeneration invalide les anciens codes.
        </p>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Devices tab
// ---------------------------------------------------------------------------
function DevicesSettings() {
  const [devices] = useState<DeviceConfig[]>([]);

  const statusBadge = (status: DeviceConfig['status']) => {
    const styles: Record<string, string> = {
      connected: 'bg-green-100 text-green-700',
      disconnected: 'bg-red-100 text-red-700',
      simulated: 'bg-yellow-100 text-yellow-700',
    };
    const labels: Record<string, string> = {
      connected: 'Connecte',
      disconnected: 'Deconnecte',
      simulated: 'Simule (MVP)',
    };
    return (
      <span
        className={`text-xs font-medium px-2.5 py-1 rounded-lg ${styles[status]}`}
      >
        {labels[status]}
      </span>
    );
  };

  const typeIcon: Record<string, string> = {
    printer: '\u{1F5A8}',
    scanner: '\u{1F4F7}',
    drawer: '\u{1F4B0}',
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Peripheriques connectes"
        description="Gerez les imprimantes, scanners et tiroir-caisse"
      >
        <div className="space-y-3">
          {devices.map((device) => (
            <div
              key={device.id}
              className="flex items-center justify-between p-4 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-center gap-4">
                <span className="text-2xl">{typeIcon[device.type]}</span>
                <div>
                  <h4 className="font-medium text-sm">{device.name}</h4>
                  <p className="text-xs text-gray-400">Port: {device.port}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {statusBadge(device.status)}
                <button className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  Configurer
                </button>
              </div>
            </div>
          ))}
        </div>

        <button className="mt-4 w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors">
          + Detecter un peripherique
        </button>
      </SectionCard>

      <SectionCard
        title="Mode peripheriques"
        description="En mode MVP, tous les peripheriques sont simules"
      >
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-sm text-yellow-800">
            <strong>Mode simulation actif.</strong> L'imprimante affiche les
            tickets dans la console, le scanner capture les saisies clavier, et
            le tiroir-caisse est simule. Les drivers physiques seront disponibles
            en V1.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Currency settings tab
// ---------------------------------------------------------------------------
function CurrencySettings() {
  const [baseCurrency, setBaseCurrency] = useState('EUR');
  const [displayCurrencies, setDisplayCurrencies] = useState([
    'EUR',
    'GBP',
    'USD',
  ]);

  const toggleDisplayCurrency = (code: string) => {
    if (code === baseCurrency) return; // ne peut pas desactiver la devise de base
    setDisplayCurrencies((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : [...prev, code],
    );
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Devise principale"
        description="Devise utilisee pour la comptabilite et les rapports"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Devise de base
          </label>
          <select
            value={baseCurrency}
            onChange={(e) => {
              setBaseCurrency(e.target.value);
              if (!displayCurrencies.includes(e.target.value)) {
                setDisplayCurrencies([...displayCurrencies, e.target.value]);
              }
            }}
            className="w-48 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {currencyOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-2">
            Tous les montants internes sont stockes en unites mineures
            (centimes) de cette devise.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Devises d'affichage"
        description="Devises supplementaires affichees pour les clients et rapports"
      >
        <div className="grid grid-cols-4 gap-3">
          {currencyOptions.map((code) => (
            <label
              key={code}
              className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
                displayCurrencies.includes(code)
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              } ${code === baseCurrency ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              <input
                type="checkbox"
                checked={displayCurrencies.includes(code)}
                onChange={() => toggleDisplayCurrency(code)}
                disabled={code === baseCurrency}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm font-medium">{code}</span>
              {code === baseCurrency && (
                <span className="text-xs text-blue-600 ml-auto">base</span>
              )}
            </label>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Taux de change"
        description="Les taux sont mis a jour automatiquement (MVP: taux manuels)"
      >
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">
                  Paire
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">
                  Taux
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">
                  Derniere MAJ
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                { pair: 'EUR/GBP', rate: 0.8612, date: '2026-02-16' },
                { pair: 'EUR/USD', rate: 1.0842, date: '2026-02-16' },
                { pair: 'EUR/AED', rate: 3.9821, date: '2026-02-16' },
                { pair: 'EUR/JPY', rate: 162.45, date: '2026-02-16' },
                { pair: 'EUR/CHF', rate: 0.9634, date: '2026-02-16' },
              ].map((fx) => (
                <tr key={fx.pair} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-mono">{fx.pair}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {fx.rate.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">
                    {fx.date}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          En V1, les taux seront recuperes automatiquement via une API externe
          (BCE, OpenExchangeRates).
        </p>
      </SectionCard>

      <div className="flex justify-end">
        <button className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
          Sauvegarder les devises
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Jackpot & Assets settings tab
// ---------------------------------------------------------------------------
function JackpotAssetsSettings() {
  const [config, setConfig] = useState({
    megaJackpotQuotaPerDay: 1,
    smallWinQuotaPerDay: 3,
    densityThresholdForMega: 8,
    megaProbabilityPercent: 5,
    smallWinProbabilityPercent: 15,
    rouletteVideoUrl: '',
    winVideoUrl: '',
    thanksVideoUrl: '',
    winAudioUrl: '',
    thanksAudioUrl: '',
    openWeatherApiKey: '',
    openWeatherCity: '',
  });

  const updateField = (field: string, value: string | number) => {
    setConfig({ ...config, [field]: value });
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Quotas quotidiens"
        description="Nombre maximum de gains par jour (verrouille par le siege)"
      >
        <div className="grid grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mega Jackpots / jour
            </label>
            <input
              type="number"
              min={0}
              max={10}
              value={config.megaJackpotQuotaPerDay}
              onChange={(e) => updateField('megaJackpotQuotaPerDay', parseInt(e.target.value) || 0)}
              className="w-24 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Petits gains / jour
            </label>
            <input
              type="number"
              min={0}
              max={50}
              value={config.smallWinQuotaPerDay}
              onChange={(e) => updateField('smallWinQuotaPerDay', parseInt(e.target.value) || 0)}
              className="w-24 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Seuil densite (personnes)
            </label>
            <input
              type="number"
              min={1}
              value={config.densityThresholdForMega}
              onChange={(e) => updateField('densityThresholdForMega', parseInt(e.target.value) || 1)}
              className="w-24 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Le mega jackpot ne s'active que si le nombre de personnes en magasin depasse ce seuil
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Probabilites"
        description="Pourcentage de chance de gain par transaction"
      >
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Probabilite Mega Jackpot (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={config.megaProbabilityPercent}
              onChange={(e) => updateField('megaProbabilityPercent', parseFloat(e.target.value) || 0)}
              className="w-28 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Probabilite Petit Gain (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={config.smallWinProbabilityPercent}
              onChange={(e) => updateField('smallWinProbabilityPercent', parseFloat(e.target.value) || 0)}
              className="w-28 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Medias Jackpot"
        description="URLs des videos et sons pour l'animation casino sur l'ecran client"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Video roulette (tirage)
            </label>
            <input
              type="url"
              value={config.rouletteVideoUrl}
              onChange={(e) => updateField('rouletteVideoUrl', e.target.value)}
              placeholder="https://cdn.example.com/roulette.mp4"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Video victoire
              </label>
              <input
                type="url"
                value={config.winVideoUrl}
                onChange={(e) => updateField('winVideoUrl', e.target.value)}
                placeholder="https://cdn.example.com/win.mp4"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Video remerciement (pas de gain)
              </label>
              <input
                type="url"
                value={config.thanksVideoUrl}
                onChange={(e) => updateField('thanksVideoUrl', e.target.value)}
                placeholder="https://cdn.example.com/thanks.mp4"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Son victoire
              </label>
              <input
                type="url"
                value={config.winAudioUrl}
                onChange={(e) => updateField('winAudioUrl', e.target.value)}
                placeholder="https://cdn.example.com/win.mp3"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Son remerciement
              </label>
              <input
                type="url"
                value={config.thanksAudioUrl}
                onChange={(e) => updateField('thanksAudioUrl', e.target.value)}
                placeholder="https://cdn.example.com/thanks.mp3"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Si une URL est vide, une animation de fallback (texte + CSS) sera affichee automatiquement.
          Formats recommandes : MP4 (H.264) pour les videos, MP3 pour les sons.
        </p>
      </SectionCard>

      <SectionCard
        title="Meteo (OpenWeather)"
        description="Configuration de la meteo affichee sur l'ecran vendeur"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cle API OpenWeatherMap
            </label>
            <input
              type="password"
              value={config.openWeatherApiKey}
              onChange={(e) => updateField('openWeatherApiKey', e.target.value)}
              placeholder="Votre cle API..."
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ville
            </label>
            <input
              type="text"
              value={config.openWeatherCity}
              onChange={(e) => updateField('openWeatherCity', e.target.value)}
              placeholder="Paris"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <button className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
          Sauvegarder la configuration Jackpot
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SettingsPage
// ---------------------------------------------------------------------------
export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('store');

  const tabContent: Record<SettingsTab, React.ReactNode> = {
    store: <StoreSettings />,
    promos: <PromosSettings />,
    stock: <StockSettings />,
    employees: <EmployeesSettings />,
    devices: <DevicesSettings />,
    currency: <CurrencySettings />,
    jackpot: <JackpotAssetsSettings />,
  };

  return (
    <div className="p-8 space-y-6 max-w-[1200px]">
      <div>
        <h2 className="text-2xl font-bold text-bo-text">Reglages</h2>
        <p className="text-bo-muted text-sm mt-1">
          Configuration de votre point de vente
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-bo-subtle p-1 rounded-2xl w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
              activeTab === tab.key
                ? 'bg-white text-bo-text shadow-soft'
                : 'text-bo-muted hover:text-bo-text'
            }`}
          >
            <span className="text-base">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>{tabContent[activeTab]}</div>
    </div>
  );
}
