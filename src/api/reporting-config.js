export function readReportingConfig() {
  const requested = String(process.env.ARTSOUL_REPORTING_ENABLED || '').toLowerCase() === 'true';
  const dailyLimit = Number(process.env.ARTSOUL_REPORT_DAILY_LIMIT);
  const dailyLimitConfigured = Number.isSafeInteger(dailyLimit) && dailyLimit > 0;

  return {
    requested,
    enabled: requested && dailyLimitConfigured,
    profileEnabled: requested && dailyLimitConfigured && process.env.ARTSOUL_PROFILE_REPORTS_ENABLED === 'true',
    dailyLimit: dailyLimitConfigured ? dailyLimit : null
  };
}
