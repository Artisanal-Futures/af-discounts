export * from "./types";
import type { Discount, Cart, CartItem, Customer, DiscountContext } from "./types";

export function isWithinDateRange(discount: Discount, now: Date): boolean {
  if (discount.isActive === false) return false;
  if (now.getTime() < discount.startsAt.getTime()) return false;
  if (discount.endsAt) {
    if (now.getTime() > discount.endsAt.getTime()) return false;
  }
  return true;
}

export function isEligibleCustomer(discount: Discount, customer?: Customer): boolean {
  if (!discount.customers || discount.customers.length === 0) return true;
  if (!customer) return false;
  return discount.customers.includes(customer.id);
}

export function hasCustomerRemainingUses(discount: Discount, customerId?: string, context?: DiscountContext): boolean {
  const discountId = discount.code || discount.id;
  if (discount.maximumUses && (context?.usageGlobal?.[discountId] ?? 0) >= discount.maximumUses) {
    return false;
  }
  if (customerId && (discount.limitOncePerCustomer || discount.maximumUsesPerCustomer)) {
    const customerUses = context?.usageByCustomer?.[discountId] ?? 0;
    if (discount.limitOncePerCustomer && customerUses >= 1) return false;
    if (discount.maximumUsesPerCustomer && customerUses >= discount.maximumUsesPerCustomer) return false;
  }
  return true;
}

export function meetsCartTotalRequirements(discount: Discount, cart: Cart): boolean {
  const cartSubtotal = cart.items.reduce((sum, item) => sum + item.priceInCents * item.quantity, 0);
  const cartQuantity = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  if (discount.minimumPurchaseInCents && cartSubtotal < discount.minimumPurchaseInCents) return false;
  if (discount.minimumQuantity && cartQuantity < discount.minimumQuantity) return false;
  return true;
}

export function isEligibleForCountry(discount: Discount, countryCode?: string): boolean {
  if (discount.applyToAllCountries === true) {
    return true;
  }
  const hasCountryRestrictions = Array.isArray(discount.countryCodes) && discount.countryCodes.length > 0;
  if (hasCountryRestrictions) {
    return !!countryCode && discount.countryCodes!.includes(countryCode);
  }
  return true;
}

export function isItemEligibleForProductDiscount(discount: Discount, item: CartItem): boolean {
  if (discount.type !== 'PRODUCT') return false;
  if (discount.applyToAllProducts) return true;
  if (discount.variants?.includes(item.variantId)) return true;
  if (discount.collections?.some(id => item.collectionIds.includes(id))) return true;
  return false;
}

export function evaluateDiscounts(cart: Cart, discounts: Discount[], customer?: Customer, context?: DiscountContext): Discount[] {
  const now = context?.now || new Date();
  return discounts.filter(discount => {
    if (!isWithinDateRange(discount, now)) {
      return false;
    }
    if (!isEligibleCustomer(discount, customer)) {
      return false;
    }
    if (!hasCustomerRemainingUses(discount, customer?.id, context)) {
      return false;
    }
    if (!meetsCartTotalRequirements(discount, cart)) {
      return false;
    }
    if (!isEligibleForCountry(discount, cart.shippingCountryCode)) {
      return false;
    }
    if (discount.type === 'PRODUCT') {
      const eligible = cart.items.some(item => isItemEligibleForProductDiscount(discount, item));
      return eligible;
    }
    return true;
  });
}

export function calculateDiscountAmount(
  discount: Discount,
  cart: Cart,
  subtotalAfterProductDiscounts?: number
): number {
  let amountInCents = 0;

  switch (discount.type) {
    case 'PRODUCT':
      cart.items.forEach(item => {
        if (isItemEligibleForProductDiscount(discount, item)) {
          let itemDiscount = 0;
          if (discount.amountType === 'PERCENTAGE') {
            itemDiscount = Math.round(item.priceInCents * (discount.amount / 100));
          } else { 
            itemDiscount = discount.amount;
          }
          amountInCents += Math.min(item.priceInCents, itemDiscount) * item.quantity;
        }
      });
      break;

    case 'ORDER':
      const orderSubtotal = subtotalAfterProductDiscounts ?? cart.items.reduce((sum, item) => sum + item.priceInCents * item.quantity, 0);
      
      if (discount.amountType === 'PERCENTAGE') {
        amountInCents = Math.round(orderSubtotal * (discount.amount / 100));
      } else { 
        amountInCents = discount.amount;
      }
      amountInCents = Math.min(orderSubtotal, amountInCents);
      break;

    case 'SHIPPING':
      const shippingCost = cart.shippingInCents || 0;
      amountInCents = shippingCost;
      if (discount.amountType === 'FIXED') {
          amountInCents = Math.min(shippingCost, discount.amount);
      }
      if (discount.maximumAmountForShippingInCents) {
        amountInCents = Math.min(amountInCents, discount.maximumAmountForShippingInCents);
      }
      break;
  }
  return amountInCents;
}

export function applyDiscounts(cart: Cart, discounts: Discount[]): {
  updatedCartItems: CartItem[];
  orderLevelDiscountInCents: number;
  shippingDiscountInCents: number;
  appliedDiscounts: Discount[];
} {
  const productDiscounts = discounts.filter(d => d.type === 'PRODUCT');
  const orderDiscounts = discounts.filter(d => d.type === 'ORDER');
  const shippingDiscounts = discounts.filter(d => d.type === 'SHIPPING');

  let totalProductDiscountValue = 0; 
  const updatedCartItems = cart.items.map(item => {
    let bestDiscountPerUnit = 0;
    for (const discount of productDiscounts) {
      if (isItemEligibleForProductDiscount(discount, item)) {
        let currentDiscount = (discount.amountType === 'PERCENTAGE')
          ? Math.round(item.priceInCents * (discount.amount / 100))
          : discount.amount;
        if (currentDiscount > bestDiscountPerUnit) {
          bestDiscountPerUnit = currentDiscount;
        }
      }
    }
    const actualDiscountPerUnit = Math.min(item.priceInCents, bestDiscountPerUnit);
    const finalPricePerUnit = item.priceInCents - actualDiscountPerUnit;
    totalProductDiscountValue += actualDiscountPerUnit * item.quantity; 
    return { ...item, priceInCents: finalPricePerUnit };
  });
  const subtotalAfterProducts = updatedCartItems.reduce((sum, item) => sum + item.priceInCents * item.quantity, 0);

  const productDiscountApplied = totalProductDiscountValue > 0; 

  let bestOrderDiscount: Discount | null = null;
  let maxOrderValue = -1;
  for (const discount of orderDiscounts) {
    if (discount.combineWithProductDiscounts === false && productDiscountApplied) {
      continue;
    }
    const value = calculateDiscountAmount(discount, { ...cart, items: updatedCartItems }, subtotalAfterProducts);
    if (value > maxOrderValue) {
      maxOrderValue = value;
      bestOrderDiscount = discount;
    }
  }
  const orderLevelDiscountInCents = maxOrderValue > -1 ? maxOrderValue : 0;

  const orderDiscountApplied = !!bestOrderDiscount;
  let bestShippingDiscount: Discount | null = null;
  let maxShippingValue = -1;
  for (const discount of shippingDiscounts) {
    if (discount.combineWithOrderDiscounts === false && orderDiscountApplied) {
      continue;
    }
    const value = calculateDiscountAmount(discount, cart); 
    if (value > maxShippingValue) {
      maxShippingValue = value;
      bestShippingDiscount = discount;
    }
  }
  const shippingDiscountInCents = maxShippingValue > -1 ? maxShippingValue : 0;
  const actuallyAppliedProductDiscounts: Discount[] = [];
  if (productDiscountApplied) {
      actuallyAppliedProductDiscounts.push(
          ...productDiscounts.filter(discount =>
              cart.items.some(item => isItemEligibleForProductDiscount(discount, item))
          )
      );
  }

  const appliedDiscounts = [
    ...actuallyAppliedProductDiscounts,
    bestOrderDiscount,
    bestShippingDiscount
  ].filter(Boolean) as Discount[];

  return { updatedCartItems, orderLevelDiscountInCents, shippingDiscountInCents, appliedDiscounts };
}

export function resolveStripeCompatibleDiscounts(discounts: Discount[], cart: Cart): { 
  automatic: Discount | null; 
  coupon: Discount | null; 
  freeShipping: Discount | null; 
} {
  const automaticDiscounts = discounts.filter(d => d.isAutomatic && d.type !== 'SHIPPING');
  const couponDiscounts = discounts.filter(d => !d.isAutomatic && d.code && d.type !== 'SHIPPING');
  const shippingDiscounts = discounts.filter(d => d.type === 'SHIPPING');

  let bestCoupon: Discount | null = null;
  let maxCouponValue = -1;
  for (const discount of couponDiscounts) {
    const value = calculateDiscountAmount(discount, cart);
    if (value > maxCouponValue) {
      maxCouponValue = value;
      bestCoupon = discount;
    }
  }

  let bestAutomatic: Discount | null = null;
  if (bestCoupon?.exclusive !== true) {
    let maxAutoValue = -1;
    for (const discount of automaticDiscounts) {
      const value = calculateDiscountAmount(discount, cart);
      if (value > maxAutoValue) {
        maxAutoValue = value;
        bestAutomatic = discount;
      }
    }
  }

  let bestShipping: Discount | null = null;
  let maxShippingValue = -1;
  for (const discount of shippingDiscounts) {
    const value = calculateDiscountAmount(discount, cart);
    if (value > maxShippingValue) {
      maxShippingValue = value;
      bestShipping = discount;
    }
  }

  return { automatic: bestAutomatic, coupon: bestCoupon, freeShipping: bestShipping };
}

export function previewDiscount(cart: Cart, discount: Discount, customer?: Customer, context?: DiscountContext): { // Add customer, context
  originalCart: Cart;
  discountAmount: number;
  updatedCartItems?: CartItem[];
  orderLevelDiscountInCents?: number;
  shippingDiscountInCents?: number;
  canApply: boolean;
  reason?: string;
} {
  const eligibleDiscounts = evaluateDiscounts(cart, [discount], customer, context);

  if (eligibleDiscounts.length === 0) {
    return {
      originalCart: cart,
      discountAmount: 0,
      canApply: false,
      reason: 'Discount is not eligible (e.g., date, customer, usage, country, or cart rules)'
    };
  }

  const discountAmount = calculateDiscountAmount(discount, cart);
  
  if (discountAmount === 0) {
    return {
      originalCart: cart,
      discountAmount: 0,
      canApply: false,
      reason: 'Discount eligible, but has no monetary effect on current cart contents'
    };
  }

  const result = {
    originalCart: cart,
    discountAmount,
    canApply: true
  };

  switch (discount.type) {
    case 'PRODUCT':
      const updatedCartItems = cart.items.map(item => {
        if (!isItemEligibleForProductDiscount(discount, item)) {
          return item; 
        }

        let itemDiscount = 0;
        if (discount.amountType === 'PERCENTAGE') {
          itemDiscount = Math.round(item.priceInCents * (discount.amount / 100));
        } else {
          itemDiscount = discount.amount;
        }
        
        const actualDiscountPerUnit = Math.min(item.priceInCents, itemDiscount);
        const finalPricePerUnit = item.priceInCents - actualDiscountPerUnit;
        
        return { ...item, priceInCents: finalPricePerUnit };
      });
      
      return { ...result, updatedCartItems };

    case 'ORDER':
      return { ...result, orderLevelDiscountInCents: discountAmount };

    case 'SHIPPING':
      return { ...result, shippingDiscountInCents: discountAmount };

    default:
      return {
        originalCart: cart,
        discountAmount: 0,
        canApply: false,
        reason: 'Unknown discount type'
      };
  }
}

export function getDiscountSummary(
  cart: Cart,
  discounts: Discount[],
  customer?: Customer,
  context?: DiscountContext
): {
  totalDiscountAmount: number;
  productDiscountAmount: number;
  orderDiscountAmount: number;
  shippingDiscountAmount: number;
  appliedDiscountCount: number;
  eligibleDiscountCount: number;
  discountBreakdown: Array<{
    discount: Discount;
    amount: number;
    type: string;
    applied: boolean;
  }>;
} {
  const eligibleDiscounts = evaluateDiscounts(cart, discounts, customer, context);
  const applied = applyDiscounts(cart, eligibleDiscounts);
  
  const discountBreakdown = discounts.map(discount => {
    const isEligible = eligibleDiscounts.includes(discount);
    const isApplied = applied.appliedDiscounts.includes(discount);
    const amount = isEligible ? calculateDiscountAmount(discount, cart) : 0;
    
    return {
      discount,
      amount,
      type: discount.type,
      applied: isApplied
    };
  });

  const productDiscountAmount = applied.updatedCartItems.reduce((total, item, index) => {
    const originalItem = cart.items[index];
    const discountPerUnit = originalItem.priceInCents - item.priceInCents;
    return total + (discountPerUnit * item.quantity);
  }, 0);

  return {
    totalDiscountAmount: productDiscountAmount + applied.orderLevelDiscountInCents + applied.shippingDiscountInCents,
    productDiscountAmount,
    orderDiscountAmount: applied.orderLevelDiscountInCents,
    shippingDiscountAmount: applied.shippingDiscountInCents,
    appliedDiscountCount: applied.appliedDiscounts.length,
    eligibleDiscountCount: eligibleDiscounts.length,
    discountBreakdown
  };
}