export type PromoType = 'buy_x_get_discount' | 'percentage' | 'fixed_amount' | 'first_purchase';

export interface PromoRule {
  id: string;
  name: string;
  type: PromoType;
  storeId: string;
  buyQuantity?: number;
  discountPercent?: number;
  discountFixedMinorUnits?: number;
  applicableProductIds?: string[];
  applicableCategoryIds?: string[];
  startDate: string;
  endDate?: string;
  isActive: boolean;
  createdAt: string;
}
