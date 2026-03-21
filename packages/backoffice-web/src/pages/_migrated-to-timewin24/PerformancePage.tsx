import { BarChart3, Clock } from 'lucide-react';

/**
 * PerformancePage — Bientôt disponible
 *
 * Ce module permettra de suivre les performances individuelles
 * des caissiers (vitesse, panier moyen, classement, objectifs).
 * Le backend /performance n'est pas encore implémenté.
 */
export function PerformancePage() {
  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto mb-6">
          <BarChart3 size={32} className="text-violet-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">
          Performance individuelle
        </h1>
        <p className="text-gray-500 mb-2">
          Ce module est en cours de développement.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 text-amber-700 text-sm font-medium">
          <Clock size={14} />
          Bientôt disponible
        </div>
        <p className="text-sm text-gray-400 mt-6">
          Suivi des KPIs caissier : vitesse de scan, panier moyen, classement, objectifs.
        </p>
      </div>
    </div>
  );
}
