const express = require('express');
const userService = require('../services/userService');
const friendService = require('../services/friendService');
const router = express.Router();
const supabase = require('../config/supabase');

router.post('/review', async (req, res) => {
  try {
    const { reviewerId, reviewedUserId, rating } = req.body;

    if (!reviewerId || !reviewedUserId || !rating == null) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    if (reviewerId === reviewedUserId) {
      return res.status(400).json({ error: 'Cannot review yourself' });
    }

    // Fetch existing review (if any)
    const { data: existingReview } = await supabase
      .from('user_reviews')
      .select('rating')
      .eq('reviewer_id', reviewerId)
      .eq('reviewed_user_id', reviewedUserId)
      .maybeSingle();

    // Fetch current aggregates
    const { data: user } = await supabase
      .from('users')
      .select('rating_total, rating_count')
      .eq('id', reviewedUserId)
      .single();

    let newTotal = user.rating_total;
    let newCount = user.rating_count;

    if (existingReview) {
      // Update existing review
      const delta = rating - existingReview.rating;
      newTotal += delta;

      await supabase
        .from('user_reviews')
        .update({ rating, updated_at: new Date() })
        .eq('reviewer_id', reviewerId)
        .eq('reviewed_user_id', reviewedUserId);

    } else {
      // Insert new review
      newTotal += rating;
      newCount += 1;

      await supabase
        .from('user_reviews')
        .insert({
          reviewer_id: reviewerId,
          reviewed_user_id: reviewedUserId,
          rating
        });
    }

    // Update user aggregates
    await supabase
      .from('users')
      .update({
        rating_total: newTotal,
        rating_count: newCount
      })
      .eq('id', reviewedUserId);

    console.log(`[REVIEW] User ${reviewerId} rated ${reviewedUserId}: ${rating}`);
    res.json({ success: true });

  } catch (err) {
    console.error('Review error:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

router.get('/review/:reviewerId/:reviewedUserId', async (req, res) => {
  const { reviewerId, reviewedUserId } = req.params;

  const { data, error } = await supabase
    .from('user_reviews')
    .select('rating')
    .eq('reviewer_id', reviewerId)
    .eq('reviewed_user_id', reviewedUserId)
    .single();

  if (error || !data) {
    return res.json({ rating: null });
  }

  res.json({ rating: data.rating });
});

router.get('/user-rating/:userId', async (req, res) => {
  const { userId } = req.params;

  const { data, error } = await supabase
    .from('users')
    .select('rating_total, rating_count')
    .eq('id', userId)
    .single();

  if (error || !data || data.rating_count === 0) {
    return res.json({ average: null, count: 0 });
  }

  res.json({
    average: Number((data.rating_total / data.rating_count).toFixed(1)),
    count: data.rating_count
  });
});

router.get('/generate-user-id', async (req, res) => {
  try {
    const user = await userService.createUser();
    console.log(`[USER] Generated new user: ${user.id} (${user.username})`);
    res.json({ userId: user.id, username: user.username });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/is-blocked', async (req, res) => {
  try {
    const { blockerUsername, blockedUsername } = req.query;

    if (!blockerUsername || !blockedUsername) {
      return res.status(400).json({ error: 'Both blockerUsername and blockedUsername query parameters are required.' });
    }

    if (blockerUsername === blockedUsername) {
      // A user cannot block themselves, so the status is always false.
      return res.json({ isBlocked: false });
    }

    // Fetch both users in a single query for efficiency
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, username, blocked_users')
      .in('username', [blockerUsername, blockedUsername]);

    if (usersError) throw usersError;

    const blocker = users.find(u => u.username === blockerUsername);
    const blocked = users.find(u => u.username === blockedUsername);

    if (!blocker) {
      return res.status(404).json({ error: `User '${blockerUsername}' not found.` });
    }
    if (!blocked) {
      return res.status(404).json({ error: `User '${blockedUsername}' not found.` });
    }

    const blockedUsersList = blocker.blocked_users || [];
    const isBlocked = blockedUsersList.includes(blocked.id);

    res.json({ isBlocked });
  } catch (error) {
    console.error('Error checking block status:', error);
    res.status(500).json({ error: 'Failed to check block status' });
  }
});

router.post('/submit-report', async (req, res) => {
  try {
    const {
      id,
      reporter_user_id,
      reporter_username,
      reported_user_id,
      reported_username,
      reason,
      last_message_json,
      created_at
    } = req.body;

    const { error } = await supabase
      .from('user_reports')
      .insert({
        ...(id && { id }),
        reporter_user_id,
        reporter_username,
        reported_user_id,
        reported_username,
        reason,
        last_message_json,
        created_at: created_at || new Date()
      });

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error submitting report:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

router.put('/:userId/pfp', async (req, res) => {
  try {
    const { userId } = req.params;

    // accept any of these from frontend
    const { pfpLink, pfp_background, bg } = req.body;

    const backgroundLink = bg || pfp_background;

    if (!pfpLink && !backgroundLink) {
      return res.status(400).json({ error: 'pfpLink or background is required' });
    }

    const updates = {};
    if (pfpLink) updates.pfp = pfpLink;
    if (backgroundLink) updates["pfp-background"] = backgroundLink; // <-- IMPORTANT

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select('id, pfp, "pfp-background"')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User not found' });

    console.log(`[USER] Updated PFP assets for user ${userId}`);

    res.json({
      success: true,
      pfp: data.pfp,
      // return a friendly key name to frontend:
      pfp_background: data["pfp-background"],
    });
  } catch (err) {
    console.error('Error updating PFP assets:', err);
    res.status(500).json({ error: 'Failed to update profile assets' });
  }
});

router.get('/:userId/pfp', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('users')
      .select('pfp, "pfp-background"')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return res.status(404).json({ error: 'User not found' });

    res.json({
      pfpLink: data.pfp,
      pfp_background: data["pfp-background"],
    });
  } catch (err) {
    console.error('Error getting PFP assets:', err);
    res.status(500).json({ error: 'Failed to retrieve profile assets' });
  }
});

router.get('/:userId', async (req, res) => {
  try {
    const user = await userService.getUser(req.params.userId);
    res.json(user);
  } catch (error) {
    res.status(404).json({ error: 'User not found' });
  }
});

router.put('/:userId', async (req, res) => {
  try {
    const user = await userService.updateUser(req.params.userId, req.body);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:userId/report', async (req, res) => {
  try {
    const user = await userService.reportUser(req.params.userId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:userId/friends', async (req, res) => {
  try {
    const { friendId } = req.body;
    const user = await userService.addFriend(req.params.userId, friendId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:userId/block', async (req, res) => {
  try {
    const { userId } = req.params;
    const { blockedUserId } = req.body;

    if (!blockedUserId) {
      return res.status(400).json({ error: 'blockedUserId is required' });
    }

    if (userId === blockedUserId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    // Fetch the current user's blocked list
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('blocked_users')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const blockedUsers = user.blocked_users || [];

    // Add the new user to the block list if not already present
    if (blockedUsers.includes(blockedUserId)) {
      return res.json({ success: true, message: 'User already blocked.' });
    }

    const newBlockedUsers = [...blockedUsers, blockedUserId];

    const { error: updateError } = await supabase.from('users').update({ blocked_users: newBlockedUsers }).eq('id', userId);

    if (updateError) throw updateError;

    console.log(`[USER] User ${userId} blocked user ${blockedUserId}`);
    res.json({ success: true, message: 'User blocked successfully.' });
  } catch (error) {
    console.error('Error blocking user:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

router.post('/:userId/unblock', async (req, res) => {
  try {
    const { userId } = req.params;
    const { blockedUserId } = req.body;

    if (!blockedUserId) {
      return res.status(400).json({ error: 'blockedUserId is required' });
    }

    // Fetch the current user's blocked list
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('blocked_users')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const blockedUsers = user.blocked_users || [];
    const newBlockedUsers = blockedUsers.filter(id => id !== blockedUserId);

    const { error: updateError } = await supabase.from('users').update({ blocked_users: newBlockedUsers }).eq('id', userId);

    if (updateError) throw updateError;

    console.log(`[USER] User ${userId} unblocked user ${blockedUserId}`);
    res.json({ success: true, message: 'User unblocked successfully.' });
  } catch (error) {
    console.error('Error unblocking user:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

router.delete('/:userId/friends/:friendId', async (req, res) => {
  try {
    const { userId, friendId } = req.params;
    await friendService.removeFriend(userId, friendId);
    res.json({ success: true, message: 'Friend removed successfully' });
  } catch (error) {
    console.error('Error removing friend:', error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

module.exports = router;