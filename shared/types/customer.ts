export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  qrCode: string;
  loyaltyPoints: number;
  isFirstPurchase: boolean;
  isVerified: boolean;
  createdAt: string;
  storeId: string;
}
