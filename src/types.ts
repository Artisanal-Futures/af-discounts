export type DiscountType = 'PRODUCT' | 'ORDER' | 'SHIPPING';
export type DiscountAmountType = 'PERCENTAGE' | 'FIXED';

export type Discount = {
   id: string;
  code?: string;
  description?: string;

  type: DiscountType;
  amountType: DiscountAmountType;
  amount: number; // in cents for FIXED, percentage for PERCENTAGE (e.g. 10 = 10%)

  variants?: string[]; // array of variant IDs this discount applies to
  collections?: string[]; // array of collection IDs this discount applies to
  customers?: string[]; // array of customer IDs this applies to

  applyToAllProducts?: boolean;
  applyToOrder?: boolean;
  applyToShipping?: boolean;
  applyToAllCountries?: boolean;

  isAutomatic?: boolean;
  combineWithProductDiscounts?: boolean;
  combineWithOrderDiscounts?: boolean;
  combineWithShippingDiscounts?: boolean;
  exclusive?: boolean;

  limitOncePerCustomer?: boolean;
  maximumUses?: number;
  maximumUsesPerCustomer?: number;
  maximumAmountForShippingInCents?: number;

  minimumPurchaseInCents?: number;
  minimumQuantity?: number;
  countryCodes?: string[];

  startsAt: Date;
  endsAt?: Date;
  isActive?: boolean;
};

export type CartItem = {
  variantId: string;
  collectionIds: string[];
  quantity: number;
  priceInCents: number;
};

export type Cart = {
  storeId: string;
  customerId?: string;
  items: CartItem[];
  shippingInCents?: number;
  shippingCountryCode?: string;
};

export type Customer = {
  id: string;
  email?: string;
};

export type DiscountContext = {
  now: Date;
  countryCode?: string;
  usageByCustomer?: Record<string, number>; // { [discountCode]: timesUsed }
  usageGlobal?: Record<string, number>;     // { [discountCode]: timesUsed }
};
