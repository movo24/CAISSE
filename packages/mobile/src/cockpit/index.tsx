import { useState } from 'react';
import { LayoutDashboard, Store, Bell, FileText, Settings } from 'lucide-react';
import { OverviewView } from './views/OverviewView';
import { StoresView } from './views/StoresView';
import { AlertsView } from './views/AlertsView';
import { BriefView } from './views/BriefView';
import { SettingsView } from './views/SettingsView';

/**
 * Wesley Command Center — étage 5. Lazy-loaded route module à frontière propre :
 * les seules dépendances vers l'app hôte sont l'instance axios authentifiée
 * (services/api) et les primitives de design (tokens Tailwind mobile-*). Une
 * extraction future en @caisse/cockpit = déplacer ce dossier.
 *
 * Le role-gate côté client (access.ts) est de l'UX — la GARANTIE est le scope
 * INV-5 côté serveur : chaque endpoint filtre sur le périmètre résolu du porteur
 * du JWT, quoi que ce composant affiche.
 */
const TABS = [
  { key: 'overview', label: 'Vue', icon: LayoutDashboard, view: OverviewView },
  { key: 'stores', label: 'Magasins', icon: Store, view: StoresView },
  { key: 'alerts', label: 'Alertes', icon: Bell, view: AlertsView },
  { key: 'brief', label: 'Brief', icon: FileText, view: BriefView },
  { key: 'settings', label: 'Réglages', icon: Settings, view: SettingsView },
] as const;

export default function CockpitPage() {
  const [active, setActive] = useState<(typeof TABS)[number]['key']>('overview');
  const ActiveView = TABS.find((t) => t.key === active)!.view;

  return (
    <div className="flex flex-col min-h-full">
      <header className="px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold">Cockpit</h1>
      </header>
      <div className="flex gap-1 px-4 pb-2 overflow-x-auto hide-scrollbar">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap touch-target ${
                isActive ? 'bg-mobile-accent text-white' : 'bg-white border border-mobile-border/60 text-mobile-muted'
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1">
        <ActiveView />
      </div>
    </div>
  );
}
