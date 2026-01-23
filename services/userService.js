// services/userService.js
const supabase = require('../config/supabase');
const { v4: uuidv4, v5: uuidv5 } = require('uuid');

const FIREBASE_UID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const adjectives = ['Shearing', 'Dancing', 'Flying', 'Singing', 'Jumping', 'Glowing', 'Sparkling', 'Whispering', 'Laughing', 'Dreaming', 'Floating', 'Spinning', 'Bouncing', 'Twinkling', 'Giggling'];
const nouns = ['Ramen', 'Pizza', 'Taco', 'Sushi', 'Waffle', 'Muffin', 'Cookie', 'Donut', 'Bagel', 'Pancake', 'Noodle', 'Pretzel', 'Croissant', 'Burrito', 'Sandwich'];

class UserService {
  constructor() {
    // 🧠 IN-MEMORY CACHE for Guests
    // Stores { id, username, created_at } to avoid hitting DB on homepage load
    this.guestCache = new Map();

    // Cleanup interval: Remove guests older than 24 hours to save RAM
    setInterval(() => {
      const now = Date.now();
      for (const [id, user] of this.guestCache.entries()) {
        if (now - new Date(user.created_at).getTime() > 24 * 60 * 60 * 1000) {
          this.guestCache.delete(id);
        }
      }
    }, 60 * 60 * 1000); // Run every hour
  }

  // 1. MODIFIED: Create user in MEMORY only
  async createUser() {
    const userId = uuidv4();
    const username = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
    
    const newUser = {
      id: userId,
      username,
      created_at: new Date().toISOString(),
      is_guest: true, // internal flag
      matches_remaining: 5, // <--- ADD THIS
      last_match_reset: new Date().toISOString() // <--- ADD THIS
    };

    // Store in RAM, do NOT write to DB yet
    this.guestCache.set(userId, newUser);
    
    return newUser;
  }

  // Add this helper method to the class
  async checkDailyReset(user) {
    if (user.is_guest) return user; // Guests don't get daily resets
    
    const lastReset = new Date(user.last_match_reset);
    const now = new Date();
    
    // Check if it's a different day
    if (lastReset.toDateString() !== now.toDateString()) {
      const { data } = await supabase
        .from('users')
        .update({ 
          matches_remaining: 50, 
          last_match_reset: now.toISOString() 
        })
        .eq('id', user.id)
        .select().single();
      return data || user;
    }
    return user;
  }

  // 2. MODIFIED: Check Memory first, then DB
  async getUser(userId) {
    // Check Cache First
    if (this.guestCache.has(userId)) {
      return this.guestCache.get(userId);
    }

    // Fallback to DB
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (user) {
      return await this.checkDailyReset(user); // <--- ADD THIS
    }
    return null;
  }

  // 3. NEW: The "Flush" function
  // Moves a user from RAM -> Database. Call this before Queue/Chat actions.
  async promoteGuest(userId) {
    const guest = this.guestCache.get(userId);
    if (!guest) return; // Already in DB or invalid

    // Insert into DB
    const { error } = await supabase
      .from('users')
      .insert({
        id: guest.id,
        username: guest.username,
        created_at: guest.created_at
      });

    if (error) {
      // If error is "duplicate key", it means they were already promoted concurrently. Ignore.
      if (error.code !== '23505') throw error;
    }

    // Remove from cache since they are now real
    this.guestCache.delete(userId);
    return await this.getUser(userId); // Return fresh DB record
  }

  // 4. MODIFIED: Promote guest if they try to update profile
  async updateUser(userId, updates) {
    // If they are updating, they are staying. Promote them first.
    if (this.guestCache.has(userId)) {
      await this.promoteGuest(userId);
    }

    // Check if this update completes the profile (e.g., setting gender/country)
    // If so, upgrade them from guest to regular user
    if (updates.gender && updates.country && updates.age) {
        // If they were a guest, give them the full 50 matches now
        const { data: currentUser } = await supabase.from('users').select('is_guest').eq('id', userId).single();
        if (currentUser?.is_guest) {
            updates.is_guest = false;
            updates.matches_remaining = 50;
        }
    }

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

  async getOrCreateUserFromFirebase(firebaseUid, preferredUsername) {
    if (!firebaseUid) throw new Error('firebaseUid is required');
    const userId = uuidv5(firebaseUid, FIREBASE_UID_NAMESPACE);

    // Check DB
    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (existing) return existing;

    // Create directly in DB (Firebase users are not guests)
    const username = preferredUsername || `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
    const { data, error } = await supabase
      .from('users')
      .insert({
        id: userId,
        username,
        age: 18,
        gender: 'prefer-not-to-say',
        country: 'Other',
        interests: ['bored']
      })
      .select().single();

    if (error) throw error;
    return data;
  }

  async addFriend(userId, friendId) {
    await this.promoteGuest(userId); // Ensure sender exists
    // Note: Receiver must already exist in DB to be friended
    const user = await this.getUser(userId);
    const friends = [...(user.friends || []), friendId];
    return this.updateUser(userId, { friends });
  }

  async blockUser(userId, blockedUserId) {
    await this.promoteGuest(userId);
    const user = await this.getUser(userId);
    const blocked_users = [...(user.blocked_users || []), blockedUserId];
    return this.updateUser(userId, { blocked_users });
  }

  async updateUserInterests(userId, interests) {
    await this.promoteGuest(userId);
    const { data, error } = await supabase
      .from('users')
      .update({ interests })
      .eq('id', userId)
      .select().single();
    if (error) throw error;
    return data;
  }

  async getUserInterests(userId) {
    // Can read from cache if guest
    if (this.guestCache.has(userId)) return this.guestCache.get(userId).interests || [];
    
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
    // If we are banning a guest, we technically don't need to promote them, 
    // but to persist the ban, we should.
    if (this.guestCache.has(userId)) await this.promoteGuest(userId);
    
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