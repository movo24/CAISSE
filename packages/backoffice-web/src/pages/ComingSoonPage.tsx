import { Clock, Sparkles, BarChart3, Cloud, MapPin, Users } from 'lucide-react';

const features = [
  { icon: Sparkles, label: 'Assistant IA', desc: 'Chat intelligent, rapports automatiques' },
  { icon: BarChart3, label: 'Performance Réseau', desc: 'Comparaison multi-magasins temps réel' },
  { icon: Cloud, label: 'Météo & Transport', desc: 'Impact sur le trafic client' },
  { icon: MapPin, label: 'Trafic Piéton', desc: 'Analyse de zone de chalandise' },
  { icon: Users, label: 'Staffing Analytics', desc: 'Optimisation des effectifs' },
];

export function ComingSoonPage() {
  return (
    <div className="flex items-center justify-center min-h-screen p-8">
      <div className="text-center max-w-lg">
        <div className="w-16 h-16 rounded-2xl bg-bo-accent/10 flex items-center justify-center mx-auto mb-6">
          <Clock size={32} className="text-bo-accent" />
        </div>
        <h1 className="text-3xl font-bold text-bo-text mb-2">TimeWin24</h1>
        <p className="text-bo-muted text-lg mb-8">
          Le cerveau analytique de votre réseau. Bientôt disponible.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.label}
                className="flex items-start gap-3 p-4 rounded-xl bg-bo-card border border-bo-border"
              >
                <div className="w-8 h-8 rounded-lg bg-bo-accent/10 flex items-center justify-center flex-shrink-0">
                  <Icon size={16} className="text-bo-accent" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-bo-text">{f.label}</p>
                  <p className="text-xs text-bo-muted mt-0.5">{f.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-bo-muted mt-8">
          Les modules d'intelligence ont été migrés depuis le POS. Ils seront réintégrés ici.
        </p>
      </div>
    </div>
  );
}
