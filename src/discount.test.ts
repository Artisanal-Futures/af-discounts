import {
  Discount,
  Cart,
  Customer,
  DiscountContext,
  CartItem,
} from './types';

import {
  evaluateDiscounts,
  applyDiscounts,
  resolveStripeCompatibleDiscounts,
  previewDiscount,
  calculateDiscountAmount,
} from './discount';

const TEST_START = new Date('2025-06-22T00:00:00Z');
const TEST_END = new Date('2025-06-24T00:00:00Z');
const TEST_NOW = new Date('2025-06-23T12:00:00Z');

const mockContext: DiscountContext = {
  now: TEST_NOW,
  usageByCustomer: {},
  usageGlobal: {},
};

const mockCustomer: Customer = { id: 'cust_123', email: 'test@example.com' };

function initialSubtotal(cart: Cart): number {
  return cart.items.reduce((sum, item) => sum + item.priceInCents * item.quantity, 0);
}

describe('Simple Discount Scenarios', () => {
  it('Scenario 1: should apply a flat 10% off all products', () => {
    const cart: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: [], quantity: 1, priceInCents: 10000 }] };
    const discounts: Discount[] = [{ id: 'd1', type: 'PRODUCT', amountType: 'PERCENTAGE', amount: 10, applyToAllProducts: true, isAutomatic: true, startsAt: TEST_START, endsAt: TEST_END, isActive: true }];
    
    const validDiscounts = evaluateDiscounts(cart, discounts, mockCustomer, mockContext);
    const result = applyDiscounts(cart, validDiscounts);

    const expectedDiscountAmount = 1000;
    const newSubtotal = result.updatedCartItems.reduce((sum, item) => sum + (item.priceInCents * item.quantity), 0);
    
    expect(initialSubtotal(cart) - newSubtotal).toBe(expectedDiscountAmount);
  });

  it('Scenario 2: should only apply a $5 discount when min spend is met', () => {
    const discount: Discount = { id: 'd2', type: 'ORDER', amountType: 'FIXED', amount: 500, minimumPurchaseInCents: 5000, startsAt: TEST_START, endsAt: TEST_END, isActive: true };
    
    const cart1: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: [], quantity: 1, priceInCents: 4000 }] };
    const validDiscounts1 = evaluateDiscounts(cart1, [discount], mockCustomer, mockContext);
    expect(validDiscounts1).toHaveLength(0);

    const cart2: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: [], quantity: 1, priceInCents: 6000 }] };
    const validDiscounts2 = evaluateDiscounts(cart2, [discount], mockCustomer, mockContext);
    const result2 = applyDiscounts(cart2, validDiscounts2);
    expect(result2.orderLevelDiscountInCents).toBe(500);
  });
  
  it('Scenario 3: should apply free shipping only to the correct country', () => {
    const discount: Discount = { id: 'd3', type: 'SHIPPING', amountType: 'PERCENTAGE', amount: 100, countryCodes: ['US'], startsAt: TEST_START, endsAt: TEST_END, isActive: true };
    
    const cartUS: Cart = { storeId: 's1', items: [], shippingInCents: 1000, shippingCountryCode: 'US' };
    const validDiscountsUS = evaluateDiscounts(cartUS, [discount], mockCustomer, mockContext);
    const resultUS = applyDiscounts(cartUS, validDiscountsUS);
    expect(resultUS.shippingDiscountInCents).toBe(1000);

    const cartCA: Cart = { storeId: 's1', items: [], shippingInCents: 1000, shippingCountryCode: 'CA' };
    const validDiscountsCA = evaluateDiscounts(cartCA, [discount], mockCustomer, mockContext);
    expect(validDiscountsCA).toHaveLength(0);
  });
});

describe('Intermediate Discount Scenarios', () => {
  it('Scenario 4: should apply a product-specific discount to only the eligible variant', () => {
    const eligibleItem: CartItem = { variantId: 'variant_X', collectionIds: [], quantity: 1, priceInCents: 5000 };
    const ineligibleItem: CartItem = { variantId: 'variant_Y', collectionIds: [], quantity: 1, priceInCents: 5000 };
    const cart: Cart = { storeId: 's1', items: [eligibleItem, ineligibleItem] };
    const discount: Discount = { id: 'd4', type: 'PRODUCT', amountType: 'PERCENTAGE', amount: 20, variants: ['variant_X'], startsAt: TEST_START, isActive: true };
    
    const validDiscounts = evaluateDiscounts(cart, [discount], mockCustomer, mockContext);
    const result = applyDiscounts(cart, validDiscounts);
    
    const discountedItem = result.updatedCartItems.find(item => item.variantId === 'variant_X');
    const nonDiscountedItem = result.updatedCartItems.find(item => item.variantId === 'variant_Y');
    
    expect(discountedItem?.priceInCents).toBe(4000); 
    expect(nonDiscountedItem?.priceInCents).toBe(5000); 
  });

  it('Scenario 5: should apply an exclusive coupon, overriding an automatic discount', () => {
      const cart: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: [], quantity: 1, priceInCents: 10000 }] };
      const autoDiscount: Discount = { id: 'd_auto', type: 'ORDER', amountType: 'PERCENTAGE', amount: 10, isAutomatic: true, startsAt: TEST_START, isActive: true };
      const exclusiveCoupon: Discount = { id: 'd_coupon', code: 'SAVE15', type: 'ORDER', amountType: 'FIXED', amount: 1500, exclusive: true, startsAt: TEST_START, isActive: true };
      
      const validDiscounts = evaluateDiscounts(cart, [autoDiscount, exclusiveCoupon], mockCustomer, mockContext);
      const resolved = resolveStripeCompatibleDiscounts(validDiscounts, cart);

      expect(resolved.automatic).toBeNull();
      expect(resolved.coupon?.id).toBe('d_coupon');
  });

  it('Scenario 6: should not apply a discount if customer has no remaining uses', () => {
    const customerWithHistory: Customer = { id: 'cust_used_code', email: 'used@example.com' };
    const contextWithHistory: DiscountContext = { ...mockContext, usageByCustomer: { 'WELCOME10': 1 } };
    const discount: Discount = { id: 'd_welcome', code: 'WELCOME10', type: 'ORDER', amountType: 'FIXED', amount: 1000, limitOncePerCustomer: true, startsAt: TEST_START, isActive: true };
    const cart: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: [], quantity: 1, priceInCents: 5000 }] };

    const validDiscounts = evaluateDiscounts(cart, [discount], customerWithHistory, contextWithHistory);
    expect(validDiscounts).toHaveLength(0);
  });
  
  it('Scenario 7: should apply discount to items in a specific collection', () => {
    const eligibleItem: CartItem = { variantId: 'v1', collectionIds: ['summer-sale'], quantity: 1, priceInCents: 10000 };
    const cart: Cart = { storeId: 's1', items: [eligibleItem] };
    const discount: Discount = { id: 'd7', type: 'PRODUCT', amountType: 'PERCENTAGE', amount: 25, collections: ['summer-sale'], startsAt: TEST_START, isActive: true };
    
    const validDiscounts = evaluateDiscounts(cart, [discount], mockCustomer, mockContext);
    const result = applyDiscounts(cart, validDiscounts);
    const discountedItem = result.updatedCartItems[0];
    
    expect(discountedItem.priceInCents).toBe(7500);
  });
});

describe('Complex Discount Scenarios', () => {
  it('Scenario 8: should resolve to 1 automatic, 1 coupon, and 1 shipping for Stripe', () => {
    const cart: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: [], quantity: 1, priceInCents: 10000 }] };
    const discounts: Discount[] = [
      { id: 'd_auto', type: 'ORDER', amountType: 'PERCENTAGE', amount: 10, isAutomatic: true, startsAt: TEST_START, isActive: true },
      { id: 'd_coupon', code: 'SAVE10', type: 'ORDER', amountType: 'FIXED', amount: 1000, startsAt: TEST_START, isActive: true },
      { id: 'd_ship', type: 'SHIPPING', amountType: 'PERCENTAGE', amount: 100, isAutomatic: true, startsAt: TEST_START, isActive: true }
    ];
    
    const validDiscounts = evaluateDiscounts(cart, discounts, mockCustomer, mockContext);
    const resolved = resolveStripeCompatibleDiscounts(validDiscounts, cart);

    expect(resolved.automatic?.id).toBe('d_auto');
    expect(resolved.coupon?.id).toBe('d_coupon');
    expect(resolved.freeShipping?.id).toBe('d_ship');
  });

  it('Scenario 9: should apply discount only when country AND quantity match', () => {
    const discount: Discount = { id: 'd9', type: 'ORDER', amountType: 'PERCENTAGE', amount: 15, minimumQuantity: 3, countryCodes: ['CA'], startsAt: TEST_START, isActive: true };
    
    const cart1: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: [], quantity: 3, priceInCents: 1000 }], shippingCountryCode: 'US' };
    expect(evaluateDiscounts(cart1, [discount], mockCustomer, mockContext)).toHaveLength(0);
    
    const cart2: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: [], quantity: 2, priceInCents: 1000 }], shippingCountryCode: 'CA' };
    expect(evaluateDiscounts(cart2, [discount], mockCustomer, mockContext)).toHaveLength(0);

    const cart3: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: [], quantity: 3, priceInCents: 1000 }], shippingCountryCode: 'CA' };
    expect(evaluateDiscounts(cart3, [discount], mockCustomer, mockContext)).toHaveLength(1);
  });

  it('Scenario 10: should handle the full stack logic correctly', () => {
    const item1: CartItem = { variantId: 'v_eligible_1', collectionIds: [], quantity: 1, priceInCents: 5000 };
    const item2: CartItem = { variantId: 'v_eligible_2', collectionIds: [], quantity: 1, priceInCents: 7000 };
    const cart: Cart = { storeId: 's1', items: [item1, item2], shippingInCents: 1000, shippingCountryCode: 'US' };
    
    const discounts: Discount[] = [
      { id: 'd_auto_prod', type: 'PRODUCT', amountType: 'PERCENTAGE', amount: 10, variants: ['v_eligible_1', 'v_eligible_2'], isAutomatic: true, combineWithOrderDiscounts: true, startsAt: TEST_START, isActive: true },
      { id: 'd_coupon_order', code: 'BIGSPENDER', type: 'ORDER', amountType: 'FIXED', amount: 500, minimumPurchaseInCents: 10000, combineWithProductDiscounts: true, startsAt: TEST_START, isActive: true },
      { id: 'd_auto_ship', type: 'SHIPPING', amountType: 'PERCENTAGE', amount: 100, isAutomatic: true, startsAt: TEST_START, isActive: true }
    ];

    const validDiscounts = evaluateDiscounts(cart, discounts, mockCustomer, mockContext);
    const result = applyDiscounts(cart, validDiscounts);
    
    const initialItemsTotal = initialSubtotal(cart); 
    const productDiscountValue = (5000 * 0.10) + (7000 * 0.10); 
    const subtotalAfterProduct = initialItemsTotal - productDiscountValue; 
    
    expect(result.orderLevelDiscountInCents).toBe(500);
    expect(result.shippingDiscountInCents).toBe(1000);

    const finalCartItemsTotal = result.updatedCartItems.reduce((sum, item) => sum + (item.priceInCents * item.quantity), 0);
    const finalGrandTotal = finalCartItemsTotal - result.orderLevelDiscountInCents + (cart.shippingInCents! - result.shippingDiscountInCents);

    expect(finalCartItemsTotal).toBe(subtotalAfterProduct);
    expect(finalGrandTotal).toBe(10300); 
  });

  it('Scenario 11: should apply only the best discount when an item is in two sale collections', () => {
    const itemInTwoCollections: CartItem = { variantId: 'v_tshirt', collectionIds: ['c_summer', 'c_shirts'], quantity: 1, priceInCents: 10000 };
    const cart: Cart = { storeId: 's1', items: [itemInTwoCollections] };
    
    const discounts: Discount[] = [
        { id: 'd_summer', type: 'PRODUCT', amountType: 'PERCENTAGE', amount: 10, collections: ['c_summer'], startsAt: TEST_START, isActive: true },
        { id: 'd_shirts', type: 'PRODUCT', amountType: 'PERCENTAGE', amount: 20, collections: ['c_shirts'], startsAt: TEST_START, isActive: true }
    ];

    const validDiscounts = evaluateDiscounts(cart, discounts, mockCustomer, mockContext);
    const result = applyDiscounts(cart, validDiscounts);

    const discountedItem = result.updatedCartItems[0];
    const expectedPrice = 8000;

    expect(discountedItem.priceInCents).toBe(expectedPrice);
  });

    it('Scenario 12: should apply a fixed product discount to each unit in a line item', () => {
    const cart: Cart = { storeId: 's1', items: [{ variantId: 'v_mug', collectionIds: [], quantity: 3, priceInCents: 2000 }] }; // 3 mugs at $20 each
    const discount: Discount = { id: 'd_mug_sale', type: 'PRODUCT', amountType: 'FIXED', amount: 500, variants: ['v_mug'], startsAt: TEST_START, isActive: true };

    const validDiscounts = evaluateDiscounts(cart, [discount], mockCustomer, mockContext);
    const result = applyDiscounts(cart, validDiscounts);

    const initialLinePrice = 3 * 2000; 
    const expectedDiscountAmount = 3 * 500; 
    
    const finalLinePrice = result.updatedCartItems[0].priceInCents * result.updatedCartItems[0].quantity;

    expect(initialLinePrice - finalLinePrice).toBe(expectedDiscountAmount);
  });

  it('Scenario 13: should not apply an order discount that cannot be combined with product discounts', () => {
    const cart: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: ['c_sale'], quantity: 1, priceInCents: 10000 }] };
    
    const productDiscount: Discount = { id: 'd_prod', type: 'PRODUCT', amountType: 'PERCENTAGE', amount: 10, collections: ['c_sale'], isAutomatic: true, startsAt: TEST_START, isActive: true };
    const nonCombinableCoupon: Discount = { id: 'd_order', code: 'NOSTACK', type: 'ORDER', amountType: 'FIXED', amount: 1000, combineWithProductDiscounts: false, startsAt: TEST_START, isActive: true };

    const validDiscounts = evaluateDiscounts(cart, [productDiscount, nonCombinableCoupon], mockCustomer, mockContext);
    const result = applyDiscounts(cart, validDiscounts);

    const finalItemPrice = result.updatedCartItems[0].priceInCents;
    expect(finalItemPrice).toBe(9000);

    expect(result.orderLevelDiscountInCents).toBe(0);
  });  
});

describe('Additional Validation and Calculation Scenarios', () => {

  it('Scenario 14: isWithinDateRange - should return false if discount is inactive', () => {
    const discount: Discount = { id: 'd_inactive', type: 'ORDER', amountType: 'FIXED', amount: 100, startsAt: TEST_START, endsAt: TEST_END, isActive: false };
    const cart: Cart = { storeId: 's1', items: [{ variantId: 'v1', quantity: 1, collectionIds: [], priceInCents: 1000 }] };
    
    const validDiscounts = evaluateDiscounts(cart, [discount], mockCustomer, mockContext);
    expect(validDiscounts).toHaveLength(0); 
  });

  it('Scenario 15: hasCustomerRemainingUses - should prevent use if global maximumUses exceeded', () => {
    const contextWithGlobalHistory: DiscountContext = { ...mockContext, usageGlobal: { 'GLOBALMAX_CODE': 100 } }; // Used 100 times
    const discount: Discount = { id: 'd_global_max', code: 'GLOBALMAX_CODE', type: 'ORDER', amountType: 'FIXED', amount: 100, maximumUses: 100, startsAt: TEST_START, isActive: true }; // Max 100 uses
    const cart: Cart = { storeId: 's1', items: [{ variantId: 'v1', collectionIds: [], quantity: 1, priceInCents: 1000 }] };

    const validDiscounts = evaluateDiscounts(cart, [discount], mockCustomer, contextWithGlobalHistory);
    expect(validDiscounts).toHaveLength(0); 
  });

  it('Scenario 16: calculateDiscountAmount - Fixed product discount should not exceed item price', () => {
    const item: CartItem = { variantId: 'v_cheap_item', collectionIds: [], quantity: 1, priceInCents: 500 }; // $5 item
    const cart: Cart = { storeId: 's1', items: [item] };
    const discount: Discount = { id: 'd_fixed_prod_cap', type: 'PRODUCT', amountType: 'FIXED', amount: 1000, variants: ['v_cheap_item'], startsAt: TEST_START, isActive: true }; // $10 fixed discount

    const amount = calculateDiscountAmount(discount, cart);
    expect(amount).toBe(500); 
  });

  it('Scenario 17: calculateDiscountAmount - Shipping discount with maximumAmountForShippingInCents', () => {
    const cart: Cart = { storeId: 's1', items: [], shippingInCents: 1000 }; 
    const discount: Discount = { id: 'd_ship_max_cap', type: 'SHIPPING', amountType: 'PERCENTAGE', amount: 100, maximumAmountForShippingInCents: 700, startsAt: TEST_START, isActive: true }; // 100% off ($10), but max $7

    const amount = calculateDiscountAmount(discount, cart);
    expect(amount).toBe(700); 
  });

  it('Scenario 18: previewDiscount - should return updatedCartItems for a product discount', () => {
    const item: CartItem = { variantId: 'v_prod_prev', collectionIds: [], quantity: 2, priceInCents: 5000 }; 
    const cart: Cart = { storeId: 's1', items: [item] };
    const discount: Discount = { id: 'd_prod_preview', type: 'PRODUCT', amountType: 'FIXED', amount: 1000, variants: ['v_prod_prev'], startsAt: TEST_START, isActive: true };

    const result = previewDiscount(cart, discount);
    
    expect(result.canApply).toBe(true);
    expect(result.updatedCartItems).toBeDefined();
    expect(result.updatedCartItems?.[0].priceInCents).toBe(4000);
    expect(result.discountAmount).toBe(2000); 
    expect(result.orderLevelDiscountInCents).toBeUndefined(); 
    expect(result.shippingDiscountInCents).toBeUndefined(); 
  });
});