const supabase = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');

const adjectives = ['Shearing', 'Dancing', 'Flying', 'Singing', 'Jumping', 'Glowing', 'Sparkling', 'Whispering', 'Laughing', 'Dreaming', 'Floating', 'Spinning', 'Bouncing', 'Twinkling', 'Giggling'];
const nouns = ['Ramen', 'Pizza', 'Taco', 'Sushi', 'Waffle', 'Muffin', 'Cookie', 'Donut', 'Bagel', 'Pancake', 'Noodle', 'Pretzel', 'Croissant', 'Burrito', 'Sandwich'];

// In-memory fallback when Supabase is not available
const memoryUsers = new Map();

class UserService {
  async createUser() {
    const userId = uuidv4();
    const username = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
    
    const userData = {
      id: userId,
      username,
      gender: null,
      country: null,
      pfp: null,
      is_reported: false,
      friends: [],
      blocked_users: [],
      created_at: new Date().toISOString()
    };

    if (supabase) {
      const { data, error } = await supabase
        .from('users')
        .insert(userData)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      memoryUsers.set(userId, userData);
      return userData;
    }
  }

  async getUser(userId) {
    if (supabase) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return data;
    } else {
      const user = memoryUsers.get(userId);
      if (!user) throw new Error('User not found');
      return user;
    }
  }

  async updateUser(userId, updates) {
    if (supabase) {
      const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const user = memoryUsers.get(userId);
      if (!user) throw new Error('User not found');
      const updatedUser = { ...user, ...updates };
      memoryUsers.set(userId, updatedUser);
      return updatedUser;
    }
  }

  async reportUser(userId) {
    return this.updateUser(userId, { is_reported: true });
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
}

module.exports = new UserService();