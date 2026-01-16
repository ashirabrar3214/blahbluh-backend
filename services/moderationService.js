const supabase = require('../config/supabase');
const policy = require('../config/moderationPolicy');
const userService = require('./userService');

class ModerationService {
  
  // A) submitReport
  async submitReport(payload) {
    const { 
      reporter_user_id, 
      reported_user_id, 
      reason, 
      evidence, // mapped from last_message_json
      chat_id,
      reporter_username,
      reported_username
    } = payload;

    // 1. Validate required fields
    if (!reporter_user_id || !reported_user_id || !reason) {
      throw new Error('Missing required fields: reporter_user_id, reported_user_id, reason');
    }

    const oneDayAgo = new Date(Date.now() - policy.REPORT_PAIR_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

    // 2. Anti-abuse Gates
    
    // Gate A: Pair Dedup (24h) - Check if reporter already reported this user recently
    const existingPair = await this.findExistingReportPairSince(reporter_user_id, reported_user_id, oneDayAgo);
    if (existingPair) {
      return { success: false, message: `You have already reported this user in the last ${policy.REPORT_PAIR_COOLDOWN_HOURS} hours.` };
    }

    // Gate B: Reporter Rate Limit (24h) - Max 5 reports per day
    const dailyCount = await this.countReportsByReporterSince(reporter_user_id, oneDayAgo);
    if (dailyCount >= policy.REPORTS_PER_REPORTER_PER_24H) {
      return { success: false, message: 'You have reached the daily report limit.' };
    }

    // 3. Insert Report
    const insertData = {
      reporter_user_id,
      reported_user_id,
      reason,
      chat_id,
      last_message_json: evidence, // Mapping evidence to DB column
      created_at: new Date().toISOString()
    };
    if (reporter_username) insertData.reporter_username = reporter_username;
    if (reported_username) insertData.reported_username = reported_username;

    const { error } = await supabase.from('user_reports').insert(insertData);
    if (error) throw error;

    // 4. Evaluate Reported User
    const actionTaken = await this.evaluateReportedUser(reported_user_id);

    return { success: true, actionTaken, message: 'Report submitted successfully.' };
  }

  // B) evaluateReportedUser
  async evaluateReportedUser(userId) {
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const epoch = new Date(0).toISOString();

    // Compute stats
    const uniqueReporters24h = await this.countUniqueReportersSince(userId, oneDayAgo);
    const uniqueReportersLifetime = await this.countUniqueReportersSince(userId, epoch);

    let action = { level: 'none', warnings: 0, banUntil: null, reason: null };

    // Escalation Policy
    if (uniqueReportersLifetime >= policy.LIFETIME_REPORTS_THRESHOLD_BAN) {
      const banUntil = new Date(now + policy.BAN_DURATION_LIFETIME_ESCALATION * 60 * 60 * 1000);
      await this.applyBan(userId, banUntil, 'Excessive lifetime reports', 'system_escalation');
      action = { level: 'ban', banUntil, reason: 'Excessive lifetime reports' };
    } else if (uniqueReporters24h >= policy.DAILY_REPORTS_THRESHOLD_BAN_24H) {
      const banUntil = new Date(now + policy.BAN_DURATION_HIGH_VOLUME * 60 * 60 * 1000);
      await this.applyBan(userId, banUntil, 'High volume of reports (24h)', 'system_escalation');
      action = { level: 'ban', banUntil, reason: 'High volume of reports (24h)' };
    } else if (uniqueReporters24h >= policy.DAILY_REPORTS_THRESHOLD_BAN_1H) {
      const banUntil = new Date(now + policy.BAN_DURATION_MULTIPLE_REPORTS * 60 * 60 * 1000);
      await this.applyBan(userId, banUntil, 'Multiple reports (24h)', 'system_escalation');
      action = { level: 'ban', banUntil, reason: 'Multiple reports (24h)' };
    } else if (uniqueReporters24h >= policy.DAILY_REPORTS_THRESHOLD_WARNING) {
      const level = uniqueReporters24h; // Warning #1 or #2
      await this.applyWarning(userId, level);
      action = { level: 'warning', warnings: level };
    }

    return action;
  }

  // C) applyWarning
  async applyWarning(userId, level) {
    await supabase
      .from('users')
      .update({ warning_count: level, last_warned_at: new Date().toISOString() })
      .eq('id', userId);
  }

  // D) applyBan
  async applyBan(userId, banUntil, reason, source) {
    // 1. Update the User's current status (existing logic)
    await userService.setBanFields(userId, {
      banned_until: banUntil.toISOString(),
      ban_reason: reason,
      ban_source: source
    });

    // 2. INSERT into ban_logs (NEW LOGIC for history)
    const now = new Date();
    const durationMs = banUntil.getTime() - now.getTime();
    const durationHours = Math.round(durationMs / (1000 * 60 * 60));

    await supabase.from('ban_logs').insert({
      user_id: userId,
      reason: reason,
      source: source,
      duration_hours: durationHours > 0 ? durationHours : 0,
      expires_at: banUntil.toISOString(),
      created_at: now.toISOString()
    });
  }

  // E) isUserBanned
  async isUserBanned(userId) {
    const { data } = await supabase.from('users').select('banned_until, ban_reason').eq('id', userId).single();
    if (data?.banned_until && new Date(data.banned_until) > new Date()) {
      return { banned: true, banned_until: data.banned_until, reason: data.ban_reason };
    }
    return { banned: false };
  }

  async getUserModerationProfile(userId) {
    // Parallel fetch: Reports and Ban Logs
    const [reportsResult, bansResult] = await Promise.all([
      supabase
        .from('user_reports')
        .select('*')
        .eq('reported_user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('ban_logs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
    ]);

    const reports = reportsResult.data || [];
    const bans = bansResult.data || [];

    // Calculate Stats
    const uniqueReporters = new Set(reports.map(r => r.reporter_user_id)).size;

    // Use the most recent ban log for "lastBanDate", or null if none
    const lastBanDate = bans.length > 0 ? bans[0].created_at : null;

    return {
      stats: {
        totalReports: reports.length,
        uniqueReporters: uniqueReporters,
        banCount: bans.length,
        lastBanDate: lastBanDate
      },
      reports: reports.map(r => ({
        id: r.id,
        reason: r.reason,
        reporter_username: r.reporter_username || 'Unknown', // handled by your DB schema
        created_at: r.created_at,
        message_context: r.last_message_json // mapping your DB column to frontend expectation
      })),
      bans: bans.map(b => ({
        reason: b.reason,
        banned_at: b.created_at,
        duration: b.duration_hours
      }))
    };
  }

  // F) Query Helpers

  async countReportsByReporterSince(reporterId, since) {
    const { count } = await supabase
      .from('user_reports')
      .select('*', { count: 'exact', head: true })
      .eq('reporter_user_id', reporterId)
      .gte('created_at', since);
    return count || 0;
  }

  async findExistingReportPairSince(reporterId, reportedId, since) {
    const { data } = await supabase
      .from('user_reports')
      .select('id')
      .eq('reporter_user_id', reporterId)
      .eq('reported_user_id', reportedId)
      .gte('created_at', since)
      .maybeSingle();
    return data;
  }

  async countUniqueReportersSince(reportedId, since) {
    const { data } = await supabase
      .from('user_reports')
      .select('reporter_user_id')
      .eq('reported_user_id', reportedId)
      .gte('created_at', since);
    
    if (!data) return 0;
    const uniqueReporters = new Set(data.map(r => r.reporter_user_id));
    return uniqueReporters.size;
  }
}

module.exports = new ModerationService();
