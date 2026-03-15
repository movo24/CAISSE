export interface PricingSuggestion {
  productId: string;
  suggestedPriceMinorUnits: number;
  minPriceMinorUnits: number;
  maxPriceMinorUnits: number;
  confidence: number;
  reasoning: string;
  factors: {
    rotationSpeed: number;
    currentStock: number;
    marginPercent: number;
    elasticity: number;
  };
}

export interface RevenueForecast {
  storeId: string;
  date: string;
  estimatedRevenueMinorUnits: number;
  confidenceIntervalLow: number;
  confidenceIntervalHigh: number;
  factors: {
    dayOfWeek: string;
    isHoliday: boolean;
    holidayName?: string;
    historicalAverage: number;
    trend: number;
  };
}
