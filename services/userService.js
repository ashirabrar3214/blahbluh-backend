const supabase = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');

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

  async reportUser(userId) {
    const { data, error } = await supabase
      .from('users')
      .update({ is_reported: true })
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
}

module.exports = new UserService();