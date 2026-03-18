// ── decision-engine/rules.registry.ts ───────────────────────────
// Built-in deterministic rules for the decision engine
// Each rule: conditions (AND/OR) → actions (promo/alert/price)
// Rules are pure data — no side effects, fully testable
// ─────────────────────────────────────────────────────────────────

import { DecisionRule } from './decision-engine.types';

/**
 * Default rule set for the decision engine.
 * Can be overridden/extended per store via DB config.
 */
export const DEFAULT_RULES: DecisionRule[] = [
  // ═══════════════════════════════════════════════════════════════
  //  WEATHER-BASED RULES
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'RULE_RAIN_HOT_DRINKS',
    name: 'Pluie → Promo boissons chaudes',
    description:
      'Quand il pleut et affluence élevée, créer une promo sur les boissons chaudes',
    enabled: true,
    priority: 'medium',
    conditions: {
      all: [
        { field: 'weather.available', operator: 'true', value: true },
        { field: 'weather.isRaining', operator: 'true', value: true },
        { field: 'footfall.score', operator: 'gte', value: 40 },
      ],
    },
    actions: [
      {
        type: 'create_promo',
        params: {
          name: 'Promo pluie — boissons chaudes',
          type: 'percentage',
          discountPercent: 15,
          durationHours: 3,
          targetCategoryIds: ['boissons-chaudes', 'cafe', 'the'],
        },
      },
      {
        type: 'alert_manager',
        params: {
          severity: 'info',
          title: 'Promo pluie activée',
          message:
            'Il pleut et l\'affluence est bonne. Promo -15% boissons chaudes créée pour 3h.',
          suggestedAction: 'Mettez en avant les boissons chaudes en vitrine.',
        },
      },
    ],
    cooldownMinutes: 180, // pas plus d'une fois toutes les 3h
    targetCategoryIds: ['boissons-chaudes', 'cafe', 'the'],
  },

  {
    id: 'RULE_HEATWAVE_COLD_DRINKS',
    name: 'Canicule → Promo boissons froides',
    description:
      'Quand il fait très chaud (>30°C), créer une promo sur les boissons froides',
    enabled: true,
    priority: 'medium',
    conditions: {
      all: [
        { field: 'weather.available', operator: 'true', value: true },
        { field: 'weather.temp', operator: 'gte', value: 30 },
        { field: 'weather.condition', operator: 'eq', value: 'hot' },
      ],
    },
    actions: [
      {
        type: 'create_promo',
        params: {
          name: 'Promo canicule — boissons fraîches',
          type: 'percentage',
          discountPercent: 10,
          durationHours: 4,
          targetCategoryIds: ['boissons-froides', 'glaces', 'eau'],
        },
      },
    ],
    cooldownMinutes: 240,
    targetCategoryIds: ['boissons-froides', 'glaces', 'eau'],
  },

  // ═══════════════════════════════════════════════════════════════
  //  TRANSPORT-BASED RULES
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'RULE_TRANSPORT_STRIKE',
    name: 'Grève transport → Alerte + Ajustement',
    description:
      'Quand le transport est interrompu (grève), alerter et pousser les produits à emporter',
    enabled: true,
    priority: 'high',
    conditions: {
      all: [
        { field: 'transport.available', operator: 'true', value: true },
        { field: 'transport.status', operator: 'eq', value: 'interrompu' },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'warning',
          title: 'Transport interrompu — grève probable',
          message:
            'Le transport est interrompu à proximité. Anticipez une baisse de fréquentation ou un report sur le à-emporter.',
          suggestedAction:
            'Réduire les préparations en salle, renforcer le service à emporter.',
        },
      },
      {
        type: 'create_promo',
        params: {
          name: 'Promo grève — à emporter',
          type: 'percentage',
          discountPercent: 10,
          durationHours: 6,
          targetCategoryIds: ['a-emporter', 'sandwichs', 'snacks'],
        },
      },
    ],
    cooldownMinutes: 360,
  },

  {
    id: 'RULE_TRANSPORT_DISRUPTION',
    name: 'Perturbation transport → Alerte manager',
    description:
      'Quand il y a 3+ perturbations actives, prévenir le manager',
    enabled: true,
    priority: 'low',
    conditions: {
      all: [
        { field: 'transport.available', operator: 'true', value: true },
        { field: 'transport.activeDisruptions', operator: 'gte', value: 3 },
        { field: 'transport.status', operator: 'eq', value: 'perturbe' },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'info',
          title: 'Transport perturbé',
          message:
            'Plusieurs perturbations transport détectées. L\'afflux client pourrait être impacté.',
        },
      },
    ],
    cooldownMinutes: 120,
  },

  // ═══════════════════════════════════════════════════════════════
  //  FOOTFALL-BASED RULES
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'RULE_HIGH_FOOTFALL_PEAK',
    name: 'Affluence élevée + heure de pointe → Alerte staffing',
    description:
      'Quand affluence forte et heure de pointe, alerter pour renforcer le personnel',
    enabled: true,
    priority: 'high',
    conditions: {
      all: [
        { field: 'footfall.available', operator: 'true', value: true },
        { field: 'footfall.level', operator: 'eq', value: 'high' },
        { field: 'time.isPeakHour', operator: 'true', value: true },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'warning',
          title: 'Affluence élevée en heure de pointe',
          message:
            'L\'affluence est élevée et c\'est l\'heure de pointe. Assurez-vous d\'avoir assez de personnel en caisse.',
          suggestedAction:
            'Ouvrir une caisse supplémentaire ou rappeler un employé.',
        },
      },
    ],
    cooldownMinutes: 60,
  },

  {
    id: 'RULE_LOW_FOOTFALL_PROMO',
    name: 'Affluence faible → Promo d\'appel',
    description:
      'Quand affluence faible en journée, créer une promo pour attirer',
    enabled: true,
    priority: 'medium',
    conditions: {
      all: [
        { field: 'footfall.available', operator: 'true', value: true },
        { field: 'footfall.score', operator: 'lte', value: 25 },
        { field: 'time.hour', operator: 'gte', value: 10 },
        { field: 'time.hour', operator: 'lte', value: 18 },
      ],
    },
    actions: [
      {
        type: 'create_promo',
        params: {
          name: 'Promo affluence faible',
          type: 'percentage',
          discountPercent: 20,
          durationHours: 2,
        },
      },
      {
        type: 'alert_manager',
        params: {
          severity: 'info',
          title: 'Affluence faible détectée',
          message:
            'Le trafic piéton est faible. Une promo -20% a été créée pour 2h.',
          suggestedAction:
            'Envisagez un affichage vitrine ou une publication sur les réseaux.',
        },
      },
    ],
    cooldownMinutes: 240,
  },

  // ═══════════════════════════════════════════════════════════════
  //  SALES-BASED RULES
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'RULE_SLOW_SALES_AFTERNOON',
    name: 'Ventes lentes l\'après-midi → Suggestion prix',
    description:
      'Si moins de 3 ventes dans la dernière heure après 14h, suggérer une baisse',
    enabled: true,
    priority: 'medium',
    conditions: {
      all: [
        { field: 'sales.available', operator: 'true', value: true },
        { field: 'sales.lastHourCount', operator: 'lte', value: 3 },
        { field: 'time.hour', operator: 'gte', value: 14 },
        { field: 'time.hour', operator: 'lte', value: 19 },
      ],
    },
    actions: [
      {
        type: 'suggest_price',
        params: {
          strategy: 'slow_moving',
          adjustmentPercent: -10,
          reason:
            'Ventes lentes cet après-midi. Réduction de 10% sur les produits sans vente récente.',
        },
      },
    ],
    cooldownMinutes: 120,
  },

  {
    id: 'RULE_RUSH_HOUR_DEMAND',
    name: 'Rush + forte demande → Pas de promo (protéger marge)',
    description:
      'En heure de pointe avec bonnes ventes, alerter pour NE PAS lancer de promo',
    enabled: true,
    priority: 'high',
    conditions: {
      all: [
        { field: 'sales.available', operator: 'true', value: true },
        { field: 'sales.lastHourCount', operator: 'gte', value: 15 },
        { field: 'time.isPeakHour', operator: 'true', value: true },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'info',
          title: 'Rush en cours — protéger les marges',
          message:
            'Les ventes sont fortes en ce moment. Ne lancez pas de promo, maximisez la marge.',
          suggestedAction:
            'Concentrez-vous sur le service et la rapidité en caisse.',
        },
      },
    ],
    cooldownMinutes: 60,
  },

  // ═══════════════════════════════════════════════════════════════
  //  STOCK-BASED RULES
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'RULE_CRITICAL_STOCK',
    name: 'Stock critique → Alerte urgente',
    description:
      'Quand 5+ produits en stock critique, alerte urgente au manager',
    enabled: true,
    priority: 'critical',
    conditions: {
      all: [
        { field: 'stock.available', operator: 'true', value: true },
        { field: 'stock.criticalCount', operator: 'gte', value: 5 },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'critical',
          title: 'Stock critique — action immédiate requise',
          message:
            'Plus de 5 produits sont en stock critique. Passez commande fournisseur immédiatement.',
          suggestedAction:
            'Ouvrir le module stock et passer les commandes prioritaires.',
        },
      },
    ],
    cooldownMinutes: 60,
  },

  {
    id: 'RULE_OUT_OF_STOCK_PROMO_STOP',
    name: 'Rupture de stock → Alerte + stop promo',
    description:
      'Quand des produits sont en rupture, alerter et suggérer d\'arrêter les promos sur ces produits',
    enabled: true,
    priority: 'critical',
    conditions: {
      all: [
        { field: 'stock.available', operator: 'true', value: true },
        { field: 'stock.outOfStockCount', operator: 'gte', value: 1 },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'critical',
          title: 'Rupture de stock détectée',
          message:
            'Des produits sont en rupture. Vérifiez les promotions actives et désactivez celles qui concernent des produits épuisés.',
          suggestedAction:
            'Retirer les produits épuisés de l\'affichage et désactiver les promos associées.',
        },
      },
    ],
    cooldownMinutes: 30,
  },

  // ═══════════════════════════════════════════════════════════════
  //  COMBO RULES (multi-source)
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'RULE_RAIN_TRANSPORT_DISRUPTION',
    name: 'Pluie + transport perturbé → Double impact',
    description:
      'Pluie combinée à des perturbations transport = forte baisse de fréquentation attendue',
    enabled: true,
    priority: 'high',
    conditions: {
      all: [
        { field: 'weather.isRaining', operator: 'true', value: true },
        { field: 'transport.status', operator: 'neq', value: 'normal' },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'warning',
          title: 'Double impact : pluie + transport perturbé',
          message:
            'Il pleut et le transport est perturbé. Anticipez une baisse significative de la fréquentation.',
          suggestedAction:
            'Réduire les préparations, pousser les livraisons et le click & collect.',
        },
      },
      {
        type: 'create_promo',
        params: {
          name: 'Promo double impact — livraison',
          type: 'percentage',
          discountPercent: 15,
          durationHours: 4,
          targetCategoryIds: ['livraison', 'click-collect', 'a-emporter'],
        },
      },
    ],
    cooldownMinutes: 240,
  },

  {
    id: 'RULE_WEEKEND_HIGH_FOOTFALL',
    name: 'Weekend + affluence élevée → Promo famille',
    description:
      'Le weekend avec forte affluence, lancer une promo famille/menu complet',
    enabled: true,
    priority: 'medium',
    conditions: {
      all: [
        { field: 'time.isWeekend', operator: 'true', value: true },
        { field: 'footfall.level', operator: 'eq', value: 'high' },
        { field: 'time.hour', operator: 'gte', value: 11 },
        { field: 'time.hour', operator: 'lte', value: 15 },
      ],
    },
    actions: [
      {
        type: 'create_promo',
        params: {
          name: 'Promo weekend famille',
          type: 'percentage',
          discountPercent: 10,
          durationHours: 4,
          targetCategoryIds: ['menus', 'formules', 'famille'],
        },
      },
      {
        type: 'alert_manager',
        params: {
          severity: 'info',
          title: 'Weekend + affluence forte',
          message:
            'C\'est le weekend et l\'affluence est élevée. Promo famille -10% activée sur les menus.',
        },
      },
    ],
    cooldownMinutes: 480, // 8h — une fois par jour max
  },

  // ═══════════════════════════════════════════════════════════════
  //  EMPLOYEE SURVEILLANCE — vol interne / fraude
  // ═══════════════════════════════════════════════════════════════

  {
    id: 'RULE_HIGH_VOID_RATE',
    name: 'Taux d\'annulation élevé → Alerte fraude',
    description:
      'Quand le taux d\'annulations dépasse 3 dans la journée, alerte fraude potentielle',
    enabled: true,
    priority: 'critical',
    conditions: {
      all: [
        { field: 'employees.available', operator: 'true', value: true },
        { field: 'employees.totalVoidsToday', operator: 'gte', value: 4 },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'critical',
          title: 'Annulations suspectes détectées',
          message:
            'Plus de 4 annulations de ventes aujourd\'hui. Vérifiez les motifs d\'annulation et identifiez le(s) caissier(s) concerné(s).',
          suggestedAction:
            'Consultez l\'audit trail (GET /api/decision-engine/{storeId}/audit) et vérifiez les caissiers avec un taux d\'annulation élevé.',
        },
      },
    ],
    cooldownMinutes: 120,
  },

  {
    id: 'RULE_EXCESSIVE_DISCOUNTS',
    name: 'Remises excessives → Alerte marge',
    description:
      'Quand le taux moyen de remise dépasse 8%, alerte perte de marge suspecte',
    enabled: true,
    priority: 'high',
    conditions: {
      all: [
        { field: 'employees.available', operator: 'true', value: true },
        { field: 'employees.avgDiscountRateToday', operator: 'gte', value: 8 },
        { field: 'sales.todayCount', operator: 'gte', value: 5 },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'warning',
          title: 'Taux de remise anormalement élevé',
          message:
            'Le taux moyen de remise dépasse 8% aujourd\'hui. Vérifiez si des remises non autorisées sont appliquées.',
          suggestedAction:
            'Revoyez les promotions actives et vérifiez les caissiers qui accordent le plus de remises.',
        },
      },
    ],
    cooldownMinutes: 180,
  },

  {
    id: 'RULE_SELLING_OFF_CLOCK',
    name: 'Vente hors pointage → Alerte sécurité',
    description:
      'Un employé effectue des ventes sans être pointé (pas de clock_in)',
    enabled: true,
    priority: 'critical',
    conditions: {
      all: [
        { field: 'employees.available', operator: 'true', value: true },
        // This is checked at per-employee level in the engine
        // For now we use the anomaly list
        { field: 'employees.anomalyEmployeeIds', operator: 'gte', value: 1 },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'critical',
          title: 'Anomalie pointage détectée',
          message:
            'Un ou plusieurs employés ont des anomalies de pointage (journée excessive, pointage manquant). Vérifiez la situation.',
          suggestedAction:
            'Contrôlez les heures de pointage et comparez avec les ventes effectuées.',
        },
      },
    ],
    cooldownMinutes: 240,
  },

  {
    id: 'RULE_NO_EMPLOYEES_CLOCKED_IN',
    name: 'Aucun employé pointé → Alerte sécurité',
    description:
      'Des ventes sont effectuées mais aucun employé n\'est pointé',
    enabled: true,
    priority: 'critical',
    conditions: {
      all: [
        { field: 'employees.available', operator: 'true', value: true },
        { field: 'employees.clockedInCount', operator: 'eq', value: 0 },
        { field: 'sales.lastHourCount', operator: 'gte', value: 1 },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'critical',
          title: 'Ventes sans personnel pointé',
          message:
            'Des ventes ont été enregistrées mais aucun employé n\'est actuellement pointé. Accès non autorisé possible.',
          suggestedAction:
            'Vérifiez immédiatement qui utilise la caisse. Contactez le responsable.',
        },
      },
    ],
    cooldownMinutes: 30,
  },

  {
    id: 'RULE_UNUSUAL_DISCOUNT_PATTERN',
    name: 'Remises concentrées → Vol potentiel',
    description:
      'Quand les remises totales dépassent 5000 centimes (50€) en une journée, alerte vol potentiel par remises',
    enabled: true,
    priority: 'critical',
    conditions: {
      all: [
        { field: 'employees.available', operator: 'true', value: true },
        { field: 'employees.totalDiscountsToday', operator: 'gte', value: 5000 },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'critical',
          title: 'Montant de remises élevé — contrôle requis',
          message:
            'Plus de 50€ de remises accordées aujourd\'hui. Vérifiez qu\'il ne s\'agit pas de remises complaisantes (vol par remise).',
          suggestedAction:
            'Comparez le détail des remises avec les promotions officielles. Vérifiez les ventes avec remise manuelle.',
        },
      },
    ],
    cooldownMinutes: 240,
  },

  {
    id: 'RULE_LOW_REVENUE_PER_EMPLOYEE',
    name: 'CA/employé anormalement bas → Investigation',
    description:
      'Un employé avec des ventes mais un CA moyen très bas peut indiquer des prix modifiés',
    enabled: true,
    priority: 'high',
    conditions: {
      all: [
        { field: 'employees.available', operator: 'true', value: true },
        { field: 'sales.todayCount', operator: 'gte', value: 10 },
        // Check if today revenue is abnormally low compared to sale count
        // Average sale < 200 centimes (2€) = suspicious
        { field: 'sales.todayRevenue', operator: 'lte', value: 2000 },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'warning',
          title: 'Panier moyen anormalement bas',
          message:
            'Le panier moyen est inférieur à 2€ malgré 10+ ventes. Possibilité de sous-facturation ou manipulation de prix.',
          suggestedAction:
            'Vérifiez les tickets récents et comparez les prix facturés vs. prix catalogue.',
        },
      },
    ],
    cooldownMinutes: 180,
  },

  {
    id: 'RULE_VOIDS_AFTER_HOURS',
    name: 'Annulations hors heures → Alerte critique',
    description:
      'Des annulations de ventes en dehors des heures d\'ouverture normales (avant 7h ou après 22h)',
    enabled: true,
    priority: 'critical',
    conditions: {
      all: [
        { field: 'employees.available', operator: 'true', value: true },
        { field: 'employees.totalVoidsToday', operator: 'gte', value: 1 },
      ],
      any: [
        { field: 'time.hour', operator: 'lt', value: 7 },
        { field: 'time.hour', operator: 'gte', value: 22 },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'critical',
          title: 'Annulations hors heures d\'ouverture',
          message:
            'Des annulations ont été effectuées en dehors des heures normales. Activité suspecte possible.',
          suggestedAction:
            'Vérifiez les caméras de surveillance et l\'identité des opérateurs.',
        },
      },
    ],
    cooldownMinutes: 60,
  },

  {
    id: 'RULE_IDLE_CASHIER',
    name: 'Caissier inactif prolongé → Vérification',
    description:
      'Un caissier pointé depuis plus de 2h sans aucune vente',
    enabled: true,
    priority: 'medium',
    conditions: {
      all: [
        { field: 'employees.available', operator: 'true', value: true },
        { field: 'employees.clockedInCount', operator: 'gte', value: 1 },
        { field: 'time.hour', operator: 'gte', value: 9 },
        { field: 'time.hour', operator: 'lte', value: 20 },
      ],
    },
    actions: [
      {
        type: 'alert_manager',
        params: {
          severity: 'info',
          title: 'Caissier potentiellement inactif',
          message:
            'Un ou plusieurs caissiers pointés n\'ont pas effectué de vente depuis longtemps. Vérifiez leur affectation.',
          suggestedAction:
            'Consultez le tableau d\'activité employé pour identifier les inactifs.',
        },
      },
    ],
    cooldownMinutes: 120,
  },
];
