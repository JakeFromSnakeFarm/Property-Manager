/**
 * Shared metric calculations for dashboard and homeowner report.
 * Base math is honest; callers choose which derived metrics to emphasize.
 */
(function (global) {
  const DONE_STATUSES = new Set(['completed', 'closed', "won't_fix", 'won’t_fix']);

  const DEFAULT_CONFIG = {
    report_title: 'Property Maintenance Value Report',
    property_label: 'Rental Property',
    tracking_start: '2025-10-01',
    handyman_day_rate: 150,
    handyman_hourly_rate: 75,
  };

  function mergeConfig(config) {
    return { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  function isDone(status) {
    return DONE_STATUSES.has(status);
  }

  function isOpen(status) {
    return !isDone(status);
  }

  function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function marketEstimate(item) {
    const laborTime = num(item?.labor_time);
    const laborRate = num(item?.labor_cost_estimate);
    const parts = num(item?.parts_cost);
    return laborTime * laborRate + parts;
  }

  function amountReimbursed(item) {
    return num(item?.my_cost);
  }

  function itemSavings(item) {
    if (!isDone(item?.status)) return 0;
    return Math.max(0, marketEstimate(item) - amountReimbursed(item));
  }

  function potentialSavings(item) {
    if (!isOpen(item?.status)) return 0;
    return Math.max(0, marketEstimate(item) - amountReimbursed(item));
  }

  function trackingDays(config, now = new Date()) {
    const cfg = mergeConfig(config);
    const start = new Date(`${cfg.tracking_start}T00:00:00Z`);
    const ms = now.getTime() - start.getTime();
    return Math.max(1, Math.ceil(ms / 86400000));
  }

  function valueAddedLow(item) {
    if (!item?.include_in_value_total || !isDone(item?.status)) return 0;
    return num(item?.value_added_low);
  }

  function valueAddedHigh(item) {
    if (!item?.include_in_value_total || !isDone(item?.status)) return 0;
    return num(item?.value_added_high);
  }

  function formatCurrency(n) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
    } catch {
      return `$${n.toFixed(2)}`;
    }
  }

  function formatPercent(n) {
    if (!Number.isFinite(n)) return '0%';
    return `${Math.round(n)}%`;
  }

  function formatValueRange(low, high) {
    if (low <= 0 && high <= 0) return '—';
    if (low === high) return formatCurrency(low);
    return `${formatCurrency(low)} – ${formatCurrency(high)}`;
  }

  /** Original app formula: all items' market est minus reimb-flag my_cost only. */
  function computeLegacyMetrics(items, config, now = new Date()) {
    const cfg = mergeConfig(config);
    const days = trackingDays(cfg, now);
    let totalMarketAll = 0;
    let totalReimbFlagged = 0;
    let totalMyCostAll = 0;
    let itemCount = 0;

    for (const item of items || []) {
      itemCount += 1;
      const market = marketEstimate(item);
      const reimbursed = amountReimbursed(item);
      totalMarketAll += market;
      totalMyCostAll += reimbursed;
      if (item.asking_for_reimbursement) {
        totalReimbFlagged += reimbursed;
      }
    }

    const moneySaved = Math.max(0, totalMarketAll - totalReimbFlagged);
    const costPerDay = totalReimbFlagged / days;
    // (contractor est − what you cost) ÷ contractor est — e.g. ($1000 − $600) ÷ $1000 = 40% cheaper
    const cheaperThanContractorsPct = totalMarketAll > 0
      ? (Math.max(0, totalMarketAll - totalMyCostAll) / totalMarketAll) * 100
      : 0;

    return {
      days,
      trackingStart: cfg.tracking_start,
      itemCount,
      totalMarketAll,
      totalReimbFlagged,
      totalMyCostAll,
      moneySaved,
      costPerDay,
      costPerMonth: costPerDay * 30,
      cheaperThanContractorsPct,
      config: cfg,
    };
  }

  function computeMetricsBreakdown(items, config, now = new Date()) {
    const legacy = computeLegacyMetrics(items, config, now);
    const current = computeMetrics(items, config, now);
    const fmt = formatCurrency;

    const rows = (items || []).map((item) => {
      const market = marketEstimate(item);
      const reimbursed = amountReimbursed(item);
      const done = isDone(item.status);
      return {
        id: item.id,
        title: item.title || '(untitled)',
        status: item.status || 'new',
        done,
        market,
        reimbursed,
        reimbFlag: !!item.asking_for_reimbursement,
        itemSaved: itemSavings(item),
        estimatedOpen: potentialSavings(item),
        countsLegacyMarket: true,
        countsLegacyReimb: !!item.asking_for_reimbursement,
        countsCurrent: done,
      };
    });

    let openMarketAll = 0;
    let openMyCostAll = 0;
    let completedMarket = 0;
    let completedReimbursed = 0;
    let completedSavedSum = 0;
    for (const r of rows) {
      if (r.done) {
        completedMarket += r.market;
        completedReimbursed += r.reimbursed;
        completedSavedSum += r.itemSaved;
      } else {
        openMarketAll += r.market;
        openMyCostAll += r.reimbursed;
      }
    }

    return {
      legacy,
      current,
      rows,
      summary: {
        openMarketAll,
        openMyCostAll,
        completedMarket,
        completedReimbursed,
        completedSavedSum,
        legacyFormula: `${fmt(legacy.totalMarketAll)} (all market) − ${fmt(legacy.totalReimbFlagged)} (reimb-flag my_cost) = ${fmt(legacy.moneySaved)}`,
        legacyPerDayFormula: `${fmt(legacy.totalReimbFlagged)} ÷ ${legacy.days} days = ${fmt(legacy.costPerDay)}/day`,
        currentSavedFormula: `${fmt(current.contractorCostAvoided)} (completed market) − ${fmt(current.totalReimbursed)} (completed my_cost) = ${fmt(current.totalSavings)} per-item sum`,
        currentPerDayFormula: `${fmt(current.totalReimbursed)} (completed my_cost) ÷ ${legacy.days} days = ${fmt(current.costPerDay)}/day`,
        deltaSaved: current.totalSavings - legacy.moneySaved,
        deltaPerDay: current.costPerDay - legacy.costPerDay,
      },
    };
  }

  function computeMetrics(items, config, now = new Date()) {
    const cfg = mergeConfig(config);
    const days = trackingDays(cfg, now);

    let totalReimbursed = 0;
    let totalSavings = 0;
    let contractorCostAvoided = 0;
    let potentialSavingsTotal = 0;
    let potentialMarketTotal = 0;
    let totalPartsCost = 0;
    let totalMarketCompleted = 0;
    let totalLaborHours = 0;
    let totalHoursAll = 0;
    let valueAddedLowTotal = 0;
    let valueAddedHighTotal = 0;
    let completedCount = 0;
    let openCount = 0;

    for (const item of items || []) {
      const market = marketEstimate(item);
      const reimbursed = amountReimbursed(item);
      const hours = num(item.labor_time);
      const done = isDone(item.status);
      totalHoursAll += hours;

      if (done) {
        completedCount += 1;
        totalReimbursed += reimbursed;
        totalSavings += itemSavings(item);
        contractorCostAvoided += market;
        totalPartsCost += num(item.parts_cost);
        totalMarketCompleted += market;
        totalLaborHours += hours;
        valueAddedLowTotal += valueAddedLow(item);
        valueAddedHighTotal += valueAddedHigh(item);
      } else {
        openCount += 1;
        potentialSavingsTotal += potentialSavings(item);
        potentialMarketTotal += market;
      }
    }

    const costPerDay = totalReimbursed / days;
    const costPerMonth = costPerDay * 30;
    const netDailyCost = (totalReimbursed - valueAddedLowTotal) / days;
    const partsShare = totalMarketCompleted > 0 ? (totalPartsCost / totalMarketCompleted) * 100 : 0;
    const partsOnlyDaily = totalPartsCost / days;
    const savingsRate = contractorCostAvoided > 0 ? (totalSavings / contractorCostAvoided) * 100 : 0;
    const annualizedSavings = totalSavings / (days / 365);
    const handymanDaysEquivalent = cfg.handyman_day_rate > 0 ? totalSavings / cfg.handyman_day_rate : 0;
    const effectiveHourlyRate = totalLaborHours > 0 ? totalReimbursed / totalLaborHours : 0;

    return {
      days,
      trackingStart: cfg.tracking_start,
      completedCount,
      openCount,
      totalReimbursed,
      totalSavings,
      contractorCostAvoided,
      potentialSavingsTotal,
      potentialMarketTotal,
      costPerDay,
      costPerMonth,
      netDailyCost,
      partsShare,
      partsOnlyDaily,
      savingsRate,
      annualizedSavings,
      handymanDaysEquivalent,
      effectiveHourlyRate,
      valueAddedLowTotal,
      valueAddedHighTotal,
      totalLaborHours,
      totalHoursAll,
      config: cfg,
    };
  }

  function formatHours(n) {
    const v = num(n);
    const rounded = Math.round(v * 10) / 10;
    const label = rounded === 1 ? 'hr' : 'hrs';
    return Number.isInteger(rounded) ? `${rounded} ${label}` : `${rounded} ${label}`;
  }

  function itemMetrics(item, config, now = new Date()) {
    const cfg = mergeConfig(config);
    const market = marketEstimate(item);
    const reimbursed = amountReimbursed(item);
    const saved = itemSavings(item);
    const potential = potentialSavings(item);
    const done = isDone(item.status);
    const valLow = valueAddedLow(item);
    const valHigh = valueAddedHigh(item);

    let dailyEquivalent = 0;
    if (done && reimbursed > 0) {
      const updated = new Date(item.updated_at || item.created_at || now);
      const itemDays = Math.max(1, Math.ceil((now.getTime() - updated.getTime()) / 86400000));
      dailyEquivalent = reimbursed / itemDays;
    }

    return {
      market,
      reimbursed,
      saved,
      potential,
      done,
      valLow,
      valHigh,
      dailyEquivalent,
      partsShare: market > 0 ? (num(item.parts_cost) / market) * 100 : 0,
      config: cfg,
    };
  }

  function dataReviewReasons(item) {
    const reasons = [];
    const market = marketEstimate(item);
    const desc = String(item?.description || '');
    if (/\$\d+/.test(desc) && market === 0) {
      reasons.push('Estimate in description but cost fields are empty');
    }
    if (item?.asking_for_reimbursement && amountReimbursed(item) === 0 && market > 0) {
      reasons.push('Reimbursement flagged but amount is zero');
    }
    return reasons;
  }

  function needsDataReview(item) {
    return dataReviewReasons(item).length > 0;
  }

  global.Metrics = {
    DONE_STATUSES,
    DEFAULT_CONFIG,
    mergeConfig,
    isDone,
    isOpen,
    marketEstimate,
    amountReimbursed,
    itemSavings,
    potentialSavings,
    trackingDays,
    valueAddedLow,
    valueAddedHigh,
    formatCurrency,
    formatPercent,
    formatHours,
    formatValueRange,
    computeMetrics,
    computeLegacyMetrics,
    computeMetricsBreakdown,
    itemMetrics,
    dataReviewReasons,
    needsDataReview,
  };
})(typeof window !== 'undefined' ? window : globalThis);
