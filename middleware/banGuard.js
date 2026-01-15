// c:\Users\Asus\OneDrive\Desktop\BlahBluh\blahbluh-backend\middleware\banGuard.js

const moderationService = require('../services/moderationService');

module.exports = async (req, res, next) => {
  try {
    // Try to find userId in common locations
    // Note: Adjust property names based on your specific route payloads
    const userId = req.params.userId || req.body.userId || req.body.fromUserId || req.body.reporter_user_id;

    if (!userId) {
      // If no user ID is present, we can't check ban status.
      // Proceeding allows public routes or validation layers to handle missing fields.
      return next();
    }

    const { banned, banned_until, reason } = await moderationService.isUserBanned(userId);

    if (banned) {
      return res.status(403).json({
        error: 'Account suspended',
        message: 'You are currently banned from performing this action.',
        banned_until,
        reason
      });
    }

    next();
  } catch (error) {
    console.error('[BanGuard] Error checking ban status:', error);
    res.status(500).json({ error: 'Failed to verify account status' });
  }
};
