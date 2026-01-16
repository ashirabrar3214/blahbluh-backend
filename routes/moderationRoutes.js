const express = require('express');
const router = express.Router();
const moderationService = require('../services/moderationService');
const supabase = require('../config/supabase');
const socketService = require('../services/socketService');
const adminService = require('../services/adminService');

// --------------------------------------------------------------------------
// Public Endpoints
// --------------------------------------------------------------------------

/**
 * POST /moderation/report
 * Called by the app to report a user.
 * Delegates logic to moderationService.submitReport().
 */
router.post('/submit-report', async (req, res) => {
  try {
    const { 
      reporter_user_id, 
      reported_user_id, 
      reason, 
      evidence, 
      last_message_json,
      chat_id,
      reporter_username,
      reported_username
    } = req.body;

    const evidenceData = evidence || last_message_json;

    const result = await moderationService.submitReport({
      reporter_user_id, 
      reported_user_id, 
      reason, 
      evidence: evidenceData, 
      chat_id,
      reporter_username,
      reported_username
    });

    // Return standardized response
    res.json({ 
      success: result.success, 
      actionTaken: result.actionTaken, 
      userMessage: result.message 
    });
  } catch (error) {
    console.error('[Moderation] Report error:', error);
    res.status(500).json({ success: false, userMessage: 'Failed to submit report.' });
  }
});

// --------------------------------------------------------------------------
// Internal / Admin Endpoints
// --------------------------------------------------------------------------

/**
 * GET /moderation/stats
 * comprehensive stats for the admin dashboard
 */
router.get('/stats', async (req, res) => {
  try {
    // 1. Get Memory Stats (Real-time)
    const socketStats = socketService.getRealTimeStats();

    // 2. Get DB Stats (Persistent)
    const dbStats = await adminService.getDashboardStats();

    res.json({
      ...socketStats, // activeUsers, usersInQueue, pairedUsers, idleUsers
      ...dbStats      // totalReported, totalBlocks, lastActiveUser
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /moderation/reported
 * List reported users with summary stats.
 * Query params: 
 *   - limit: number (default 50)
 *   - status: 'active' (default) - currently fetches most recently reported users
 */
router.get('/reported', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;

    // 1. Get recent unique reported users from user_reports
    // We fetch 4x the limit to account for duplicates (same user reported multiple times)
    const { data: recentReports, error: reportError } = await supabase
      .from('user_reports')
      .select('reported_user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(limit * 4);

    if (reportError) throw reportError;

    if (!recentReports || recentReports.length === 0) {
      return res.json([]);
    }

    // Deduplicate users, keeping the most recent report date
    const userMap = new Map();
    for (const r of recentReports) {
      if (!userMap.has(r.reported_user_id)) {
        userMap.set(r.reported_user_id, r.created_at);
      }
    }

    // Slice to requested limit
    const targetUserIds = Array.from(userMap.keys()).slice(0, limit);

    // 2. Fetch user details
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, username, pfp, warning_count, banned_until')
      .in('id', targetUserIds);

    if (userError) throw userError;

    // 3. Build summary stats for each user
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const results = await Promise.all(users.map(async (user) => {
      const lastReportTime = userMap.get(user.id);
      // Use service helper for accurate counts
      const uniqueReporters24h = await moderationService.countUniqueReportersSince(user.id, oneDayAgo);
      
      // Get how many times this user has been blocked
      const blocksReceived = await adminService.getUserBlockCount(user.id);

      return {
        ...user,
        lastReportTime,
        uniqueReporters24h,
        blocksReceived,
        status: user.banned_until && new Date(user.banned_until) > new Date() ? 'banned' : 'active'
      };
    }));

    // Sort by last report time (descending)
    results.sort((a, b) => new Date(b.lastReportTime) - new Date(a.lastReportTime));

    res.json(results);
  } catch (error) {
    console.error('[Moderation] List reported error is', error);
    res.status(500).json({ error: 'Failed to list reported users' });
  }
});

/**
 * GET /moderation/reports/:userId
 * Get full moderation profile (Stats + Reports + Ban History)
 */
router.get('/reports/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Delegate complex data gathering to the service
    const data = await moderationService.getUserModerationProfile(userId);

    res.json(data);
  } catch (error) {
    console.error('[Moderation] Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch user moderation profile' });
  }
});

/**
 * POST /moderation/ban
 * Manual ban action.
 */
router.post('/ban', async (req, res) => {
  try {
    const { userId, reason, durationHours } = req.body;
    
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    // Default to 24h if not specified
    const hours = durationHours ? Number(durationHours) : 24;
    const banUntil = new Date(Date.now() + hours * 60 * 60 * 1000);

    await moderationService.applyBan(
      userId, 
      banUntil, 
      reason || 'Manual Admin Ban', 
      'admin_manual'
    );

    res.json({ success: true, banUntil, message: `User banned for ${hours} hours.` });
  } catch (error) {
    console.error('[Moderation] Ban error:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

/**
 * POST /moderation/unban
 * Manual unban action.
 */
router.post('/unban', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    // Directly update via Supabase as moderationService doesn't have unban yet
    const { error } = await supabase
      .from('users')
      .update({ 
        banned_until: null,
        ban_reason: null,
        ban_source: null
      })
      .eq('id', userId);

    if (error) throw error;

    res.json({ success: true, message: 'User unbanned successfully.' });
  } catch (error) {
    console.error('[Moderation] Unban error:', error);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

/**
 * POST /moderation/check-admin
 * Checks if the provided email matches the server-side ADMIN_EMAIL env var.
 */
router.post('/check-admin', (req, res) => {
  const { email } = req.body;
  
  // Get the admin email from environment variables (set this in Railway)
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail) {
    console.error('ADMIN_EMAIL is not set in backend environment variables.');
    return res.json({ isAdmin: false });
  }

  // Simple string comparison (case-insensitive for safety)
  if (email && email.toLowerCase() === adminEmail.toLowerCase()) {
    return res.json({ isAdmin: true });
  }

  return res.json({ isAdmin: false });
});

module.exports = router;
