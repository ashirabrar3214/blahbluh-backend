const express = require('express');
const userService = require('../services/userService');
const router = express.Router();
const supabase = require('../config/supabase');

router.post('/review', async (req, res) => {
  try {
    const { reviewerId, reviewedUserId, rating } = req.body;

    if (!reviewerId || !reviewedUserId || !rating) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    if (reviewerId === reviewedUserId) {
      return res.status(400).json({ error: 'Cannot review yourself' });
    }

    // Check existing review
    const { data: existingReview, error: fetchError } = await supabase
      .from('user_reviews')
      .select('rating')
      .eq('reviewer_id', reviewerId)
      .eq('reviewed_user_id', reviewedUserId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    if (existingReview) {
      // 🔁 UPDATE EXISTING REVIEW
      const delta = rating - existingReview.rating;

      await supabase
        .from('user_reviews')
        .update({
          rating,
          updated_at: new Date()
        })
        .eq('reviewer_id', reviewerId)
        .eq('reviewed_user_id', reviewedUserId);

      // 🔁 UPDATE USER AGGREGATES
      await supabase
        .from('users')
        .update({
          rating_total: supabase.raw(`rating_total + ${delta}`)
        })
        .eq('id', reviewedUserId);

    } else {
      // ➕ INSERT NEW REVIEW
      await supabase
        .from('user_reviews')
        .insert({
          reviewer_id: reviewerId,
          reviewed_user_id: reviewedUserId,
          rating
        });

      // ➕ UPDATE USER AGGREGATES
      await supabase
        .from('users')
        .update({
          rating_total: supabase.raw(`rating_total + ${rating}`),
          rating_count: supabase.raw(`rating_count + 1`)
        })
        .eq('id', reviewedUserId);
    }

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
    res.json({ userId: user.id, username: user.username });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const { blockedUserId } = req.body;
    const user = await userService.blockUser(req.params.userId, blockedUserId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



module.exports = router;