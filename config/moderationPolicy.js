// c:\Users\Asus\OneDrive\Desktop\BlahBluh\blahbluh-backend\config\moderationPolicy.js

module.exports = {
  // Reporting Gates
  REPORT_PAIR_COOLDOWN_HOURS: 24,
  REPORTS_PER_REPORTER_PER_24H: 5,

  // Escalation Thresholds (Unique Reporters)
  LIFETIME_REPORTS_THRESHOLD_BAN: 8,
  DAILY_REPORTS_THRESHOLD_BAN_24H: 5,
  DAILY_REPORTS_THRESHOLD_BAN_1H: 1,
  DAILY_REPORTS_THRESHOLD_WARNING: 1,

  // Ban Durations (in hours)
  BAN_DURATION_LIFETIME_ESCALATION: 7 * 24, // 7 days
  BAN_DURATION_HIGH_VOLUME: 24,
  BAN_DURATION_MULTIPLE_REPORTS: 1,
};
