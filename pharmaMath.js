/**
 * PharmaMath Utility Module
 * Handles Unit Conversion Math between Batch Weight (Kg),
 * Film Coating Status (Is Coated), Tablet Weights (mg),
 * Lots Count (عدد اللوتات/التشغيلات الفرعية), and Blister Counts.
 */

window.PharmaMath = {
  /**
   * Calculates Total Tablets, Total Blisters, and Lot Weight.
   * @param {number} weightKg - Total batch weight in Kilograms
   * @param {boolean} isCoated - Whether product is film coated
   * @param {number} preCoatingMg - Weight before coating (or single unit weight)
   * @param {number} postCoatingMg - Weight after coating (used if isCoated is true)
   * @param {number} unitsPerBlister - Count of units per blister
   * @param {number} lotsCount - Total lots count in batch
   * @returns {{ totalTablets: number, totalBlisters: number, lotWeightKg: number }}
   */
  calculateTotals(weightKg, isCoated, preCoatingMg, postCoatingMg, unitsPerBlister, lotsCount) {
    const wKg = parseFloat(weightKg) || 0;
    const preMg = parseFloat(preCoatingMg) || 0;
    const postMg = isCoated ? (parseFloat(postCoatingMg) || preMg) : preMg;
    const uPerBlister = parseInt(unitsPerBlister, 10) || 1;
    const lCount = parseInt(lotsCount, 10) || 1;

    if (wKg <= 0 || postMg <= 0 || uPerBlister <= 0) {
      return { totalTablets: 0, totalBlisters: 0, lotWeightKg: 0 };
    }

    const totalWeightMg = wKg * 1000000;
    const totalTablets = Math.floor(totalWeightMg / postMg);
    const totalBlisters = Math.floor(totalTablets / uPerBlister);
    const lotWeightKg = wKg / lCount;

    return { totalTablets, totalBlisters, lotWeightKg };
  },

  /**
   * Calculates Equivalent Blisters and Lots for a slice of weight (Kg)
   */
  kgToBlistersAndLots(kg, isCoated, preCoatingMg, postCoatingMg, unitsPerBlister, totalBatchKg, lotsCount) {
    const res = this.calculateTotals(kg, isCoated, preCoatingMg, postCoatingMg, unitsPerBlister, lotsCount);
    const lCount = parseInt(lotsCount, 10) || 1;
    const lotWeightKg = (parseFloat(totalBatchKg) || 1) / lCount;
    const equivalentLots = lotWeightKg > 0 ? (parseFloat(kg) || 0) / lotWeightKg : 0;

    return {
      totalTablets: res.totalTablets,
      totalBlisters: res.totalBlisters,
      equivalentLots: parseFloat(equivalentLots.toFixed(2))
    };
  },

  /**
   * Formats numbers with localized Arabic format
   */
  formatNumber(num) {
    if (isNaN(num)) return '0';
    return Math.round(num).toLocaleString('ar-EG');
  }
};
