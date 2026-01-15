const supabase = require('../config/supabase');
const { v4: uuidv4, v5: uuidv5 } = require('uuid');

// IMPORTANT: do NOT change this later or everyone's IDs will change.
// You can also move this to an env var if you want.
const FIREBASE_UID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const adjectives = ['Shearing', 'Dancing', 'Flying', 'Singing', 'Jumping', 'Glowing', 'Sparkling', 'Whispering', 'Laughing', 'Dreaming', 'Floating', 'Spinning', 'Bouncing', 'Twinkling', 'Giggling'];
const nouns = ['Ramen', 'Pizza', 'Taco', 'Sushi', 'Waffle', 'Muffin', 'Cookie', 'Donut', 'Bagel', 'Pancake', 'Noodle', 'Pretzel', 'Croissant', 'Burrito', 'Sandwich'];

class UserService {
  async createUser() {
    const userId = uuidv4();
    const username = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
    
    const { data, error } = await supabase
      .from('users')
      .insert({
        id: userId,
        username
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      throw error;
    }
    return data;
  }

  async getOrCreateUserFromFirebase(firebaseUid, preferredUsername) {
    if (!firebaseUid) {
      throw new Error('firebaseUid is required');
    }

    const userId = uuidv5(firebaseUid, FIREBASE_UID_NAMESPACE);

    // 1) If user already exists, return them
    const { data: existing, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (findError) {
      console.error(findError);
      throw findError;
    }

    if (existing) return existing;

    // 2) Otherwise create the user (use preferred username if given)
    const username =
      preferredUsername ||
      `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;

    const { data, error } = await supabase
      .from('users')
      .insert({ id: userId, username })
      .select()
      .single();

    if (error) {
      console.error(error);
      throw error;
    }

    return data;
  }


  async getUser(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error(error);
      throw error;
    }
    return data;
  }

  async updateUser(userId, updates) {
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error(error);
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
      .select()
      .single();

    if (error) {
      console.error(error);
      throw error;
    }
    return data;
  }

  async getUserInterests(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('interests')
      .eq('id', userId)
      .single();

    if (error) {
      console.error(error);
      if (error.code === 'PGRST116') return []; // Return empty if user not found
      throw error;
    }
    return data?.interests || [];
  }

  async setBanFields(userId, { banned_until, ban_reason, ban_source }) {
    const { data, error } = await supabase
      .from('users')
      .update({ 
        banned_until, 
        ban_reason, 
        ban_source 
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

module.exports = new UserService();