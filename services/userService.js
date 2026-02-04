// services/userService.js
const supabase = require('../config/supabase');
const { v4: uuidv4, v5: uuidv5 } = require('uuid');

const FIREBASE_UID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const adjectives = ['Shearing', 'Dancing', 'Flying', 'Singing', 'Jumping', 'Glowing', 'Sparkling', 'Whispering', 'Laughing', 'Dreaming', 'Floating', 'Spinning', 'Bouncing', 'Twinkling', 'Giggling'];
const nouns = ['Ramen', 'Pizza', 'Taco', 'Sushi', 'Waffle', 'Muffin', 'Cookie', 'Donut', 'Bagel', 'Pancake', 'Noodle', 'Pretzel', 'Croissant', 'Burrito', 'Sandwich'];

class UserService {
  constructor() {}

  // 1. SAVE TO DB DIRECTLY (Removes "RAM Cache" issue)
  async createUser() {
    const userId = uuidv4();
    const username = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
    
    const { data, error } = await supabase
      .from('users')
      .insert({
        id: userId,
        username,
        created_at: new Date().toISOString(),
        is_guest: true,
        matches_remaining: 5,
        last_match_reset: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // 2. FETCH FROM DB (Handles Daily Reset)
  async getUser(userId) {
    // Fetch directly from DB
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle(); // Prevents crashing on 404

    if (!user) return null;

    // Check for daily reset (give 50 matches if new day)
    return await this.checkDailyReset(user);
  }

  // 3. Helper for Daily Reset
  async checkDailyReset(user) {
    if (user.is_guest !== false) return user; 
    
    const lastReset = user.last_match_reset ? new Date(user.last_match_reset) : new Date(0);
    const now = new Date();
    
    // If it's a new day, just give them 50 matches.
    if (lastReset.toDateString() !== now.toDateString()) {
      const { data } = await supabase
        .from('users')
        .update({ 
          matches_remaining: 50, 
          last_match_reset: now.toISOString() 
        })
        .eq('id', user.id)
        .select()
        .single();
      return data || user;
    }
    return user;
  }

  // 4. MODIFIED: Promote guest if they try to update profile
  async updateUser(userId, updates) {
    // Check if this update completes the profile via explicit signal
    if (updates.profile_completed) {
        // If they were a guest, give them the full 50 matches now
        const { data: currentUser } = await supabase.from('users').select('is_guest').eq('id', userId).single();
        if (currentUser?.is_guest) {
            updates.is_guest = false;
            updates.matches_remaining = 50;
            updates.last_match_reset = new Date().toISOString();
        }
    }
    // Always remove the signal so it doesn't try to write to DB
    delete updates.profile_completed;

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // --- Keep Existing Logic for Firebase/Friends ---

  // [CHANGE 3] Accept 'email' as the 3rd argument
  async getOrCreateUserFromFirebase(firebaseUid, preferredUsername, email) {
    if (!firebaseUid) throw new Error('firebaseUid is required');
    const userId = uuidv5(firebaseUid, FIREBASE_UID_NAMESPACE);

    // 1. Check DB for existing user
    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (existing) {
      // [CHANGE 4] SELF-HEALING: If user exists but has no email, save it now!
      if (!existing.email && email) {
        console.log(`[UserService] Backfilling missing email for ${userId}`);
        await supabase
          .from('users')
          .update({ email: email })
          .eq('id', userId);
          
        existing.email = email; // Update local object so it returns correctly
      }
      return existing;
    }

    // 2. Create NEW user
    const username = preferredUsername || `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
    
    // [CHANGE 5] Insert 'email' into the new row
    const { data, error } = await supabase
      .from('users')
      .insert({
        id: userId,
        username,
        email: email || null, // <--- Save email here
        age: 18,
        gender: 'prefer-not-to-say',
        country: 'Other',
        interests: ['anything'],
        matches_remaining: 5,
        is_guest: true,
        last_match_reset: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
        console.error("Supabase Insert Error:", error);
        throw error;
    }
    return data;
  }

  async addFriend(userId, friendId) {
    const user = await this.getUser(userId);
    const friends = [...(user.friends || []), friendId];
    return this.updateUser(userId, { friends });
  }

  async blockUser(userId, blockedUserId) {
    const user = await this.getUser(userId);
    const blocked_users = [...(user.blocked_users || []), blockedUserId];
    return this.updateUser(userId, { blocked_users });
  }

  async updateUserInterests(userId, interests) {
    const { data, error } = await supabase
      .from('users')
      .update({ interests })
      .eq('id', userId)
      .select().single();
    if (error) throw error;
    return data;
  }

  async getUserInterests(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('interests')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return [];
      throw error;
    }
    return data?.interests || [];
  }

  async setBanFields(userId, fields) {
    const { data, error } = await supabase
      .from('users')
      .update(fields)
      .eq('id', userId)
      .select().single();
    if (error) throw error;
    return data;
  }
}

module.exports = new UserService();