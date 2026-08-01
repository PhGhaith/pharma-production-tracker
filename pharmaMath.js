/**
 * PharmaMath - Core Calculation Engine for Pharmaceutical Batches
 */

const PharmaMath = {
  /**
   * Calculates total dosage units, total blisters, and lot weights
   */
  calculateTotals: function (totalWeightKg, isCoated, preCoatingMg, postCoatingMg, unitsPerBlister, lotsCount = 1) {
    const wKg = parseFloat(totalWeightKg) || 0;
    const preMg = parseFloat(preCoatingMg) || 0;
    const postMg = isCoated ? (parseFloat(postCoatingMg) || preMg) : preMg;
    const uPerBlister = parseInt(unitsPerBlister, 10) || 1;
    const lCount = parseInt(lotsCount, 10) || 1;

    if (wKg <= 0 || postMg <= 0 || uPerBlister <= 0) {
      return {
        lotWeightKg: 0,
        totalTablets: 0,
        totalBlisters: 0,
        unitWeightMgUsed: postMg
      };
    }

    const totalWeightMg = wKg * 1000000;
    const totalTablets = Math.floor(totalWeightMg / postMg);
    const totalBlisters = Math.floor(totalTablets / uPerBlister);
    const lotWeightKg = wKg / lCount;

    return {
      lotWeightKg,
      totalTablets,
      totalBlisters,
      unitWeightMgUsed: postMg
    };
  },

  /**
   * Converts Kg to equivalent Blisters and Lots
   */
  kgToBlistersAndLots: function (kgProgress, isCoated, preCoatingMg, postCoatingMg, unitsPerBlister, totalBatchWeightKg, totalLotsCount = 1) {
    const pKg = parseFloat(kgProgress) || 0;
    const totals = this.calculateTotals(pKg, isCoated, preCoatingMg, postCoatingMg, unitsPerBlister, 1);
    
    const lotWeight = (parseFloat(totalBatchWeightKg) || 1) / (parseInt(totalLotsCount, 10) || 1);
    const equivalentLots = (pKg / lotWeight).toFixed(2);

    return {
      equivalentLots: parseFloat(equivalentLots),
      totalBlisters: totals.totalBlisters,
      totalTablets: totals.totalTablets
    };
  },

  /**
   * Converts Blisters Count back to equivalent Weight in Kg (specifically for Blistering stage)
   */
  blistersToKg: function (blistersCount, isCoated, preCoatingMg, postCoatingMg, unitsPerBlister) {
    const bCount = parseFloat(blistersCount) || 0;
    const preMg = parseFloat(preCoatingMg) || 0;
    const postMg = isCoated ? (parseFloat(postCoatingMg) || preMg) : preMg;
    const uPerBlister = parseInt(unitsPerBlister, 10) || 1;

    if (bCount <= 0 || postMg <= 0 || uPerBlister <= 0) {
      return 0;
    }

    const totalUnits = bCount * uPerBlister;
    const totalMg = totalUnits * postMg;
    const weightKg = totalMg / 1000000;

    return parseFloat(weightKg.toFixed(3));
  },

  /**
   * Formats numbers with commas
   */
  formatNumber: function (num) {
    if (isNaN(num)) return '0';
    return num.toLocaleString('ar-EG');
  }
};

if (typeof window !== 'undefined') {
  window.PharmaMath = PharmaMath;
}
