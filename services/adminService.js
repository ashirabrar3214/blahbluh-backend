// c:\Users\Asus\OneDrive\Desktop\BlahBluh\blahbluh-backend\services\adminService.js

const supabase = require('../config/supabase');

class AdminService {
  
  /**
   * Get counts for Reported and Banned users from DB.
   * Active/Paired counts are handled in memory by SocketService.
   */
  async getDbStats() {
    try {
      // Count Reported Users
      // Assuming you have an 'is_reported' flag on users, or we count unique reports
      // Option A: Using the is_reported flag from your schema
      const { count: reportedCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('is_reported', true);

      // Count Banned Users (banned_until is in the future)
      const now = new Date().toISOString();
      const { count: bannedCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .not('banned_until', 'is', null)
        .gt('banned_until', now);

      return {
        reportedUsers: reportedCount || 0,
        bannedUsers: bannedCount || 0
      };
    } catch (error) {
      // console.error('[AdminService] Error fetching stats:', error);
      return { reportedUsers: 0, bannedUsers: 0 };
    }
  }

  async getDashboardStats() {
    try {
      // 1. Total Reported Users (unique)
      const { count: reportedCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('is_reported', true);

      // 2. Total Blocks (Global count of rows in blocked_users)
      const { count: totalBlocks } = await supabase
        .from('blocked_users')
        .select('*', { count: 'exact', head: true });

      // 3. Total Banned Users
      const now = new Date().toISOString();
      const { count: bannedCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .not('banned_until', 'is', null)
        .gt('banned_until', now);

      // 4. Last Active User
      const { data: lastActive } = await supabase
        .from('users')
        .select('username, last_active_at')
        .not('last_active_at', 'is', null)
        .order('last_active_at', { ascending: false })
        .limit(1)
        .single();

      return {
        totalReported: reportedCount || 0,
        totalBlocks: totalBlocks || 0,
        totalBanned: bannedCount || 0,
        lastActiveUser: lastActive ? { username: lastActive.username, time: lastActive.last_active_at } : null
      };
    } catch (error) {
      // console.error('Error fetching admin dashboard stats:', error);
      return {};
    }
  }

  async getUserBlockCount(userId) {
    const { count } = await supabase
      .from('blocked_users')
      .select('*', { count: 'exact', head: true })
      .eq('blocked_user_id', userId);
    return count || 0;
  }

  /**
   * Get list of currently banned users.
   */
  async getBannedUsers() {
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('users')
        .select('id, username, ban_reason, pfp')
        .not('banned_until', 'is', null)
        .gt('banned_until', now);

      if (error) throw error;

      // Map DB fields to Frontend expected fields (reason, avatar)
      return data.map(u => ({
        id: u.id,
        username: u.username,
        reason: u.ban_reason || 'Reason not specified',
        avatar: u.pfp
      }));
    } catch (error) {
      // console.error('[AdminService] Error fetching banned users:', error);
      return [];
    }
  }

  /**
   * Unban a user by ID.
   */
  async unbanUser(userId) {
    try {
      const { error } = await supabase
        .from('users')
        .update({ 
          banned_until: null, 
          ban_reason: null,
          ban_source: null
        })
        .eq('id', userId);

      if (error) throw error;
      return true;
    } catch (error) {
      // console.error('[AdminService] Error unbanning user:', error);
      return false;
    }
  }

  /**
   * Search users by username.
   */
  async searchUsers(term) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, pfp, banned_until')
        .ilike('username', `%${term}%`)
        .limit(10);

      if (error) throw error;
      return data;
    } catch (error) {
      // console.error('[AdminService] Error searching users:', error);
      return [];
    }
  }
}

module.exports = new AdminService();