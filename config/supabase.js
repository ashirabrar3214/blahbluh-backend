const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rutsuzgbegwjhgrurcsr.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;
if (supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase connected');
} else {
  console.log('⚠️ Supabase key missing - running in memory mode');
}

module.exports = supabase;