#!/usr/bin/env node

/**
 * Backfill script to update seen status for Front emails
 * Fetches the most recent 500 outbound Front emails and checks their seen status
 */

const https = require('https');

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
const FRONT_API_TOKEN = process.env.FRONT_API_TOKEN;
const BATCH_SIZE = 50; // Process in batches to avoid rate limits
const DELAY_MS = 1000; // Delay between batches (1 second)

if (!SUPABASE_URL || !SUPABASE_KEY || !FRONT_API_TOKEN) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

// Helper to make HTTP requests
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// Fetch emails from Supabase
async function fetchEmails() {
  console.log('📥 Fetching outbound Front emails from Supabase...');
  
  const url = `${SUPABASE_URL}/rest/v1/z_email_history?source=eq.front&type=eq.outbound&message_id=not.is.null&order=created_at.desc&limit=500`;
  
  const data = await makeRequest(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Accept': 'application/json'
    }
  });
  
  console.log(`✅ Found ${data.length} emails to process`);
  return data;
}

// Check if a message was seen via Front API
async function checkMessageSeen(messageId) {
  try {
    const url = `https://api2.frontapp.com/messages/${messageId}/seen`;
    
    const data = await makeRequest(url, {
      headers: {
        'Authorization': `Bearer ${FRONT_API_TOKEN}`,
        'Accept': 'application/json'
      }
    });
    
    if (data._results && data._results.length > 0) {
      const seenInfo = data._results[0];
      return {
        seen: true,
        seen_at: new Date(seenInfo.first_seen_at).toISOString()
      };
    }
    
    return { seen: false, seen_at: null };
  } catch (error) {
    // If 404 or error, assume not seen
    console.warn(`⚠️  Could not check seen status for ${messageId}: ${error.message}`);
    return { seen: false, seen_at: null };
  }
}

// Update email in Supabase
async function updateEmail(id, seenData) {
  const url = `${SUPABASE_URL}/rest/v1/z_email_history?id=eq.${id}`;
  
  await makeRequest(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(seenData)
  });
}

// Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main execution
async function main() {
  console.log('🚀 Starting email seen status backfill...\n');
  
  try {
    // Fetch all emails to process
    const emails = await fetchEmails();
    
    let processed = 0;
    let seenCount = 0;
    let notSeenCount = 0;
    let errorCount = 0;
    
    // Process in batches
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${i + 1}-${Math.min(i + BATCH_SIZE, emails.length)} of ${emails.length})`);
      
      // Process batch concurrently
      await Promise.all(batch.map(async (email) => {
        try {
          const seenData = await checkMessageSeen(email.message_id);
          await updateEmail(email.id, seenData);
          
          processed++;
          if (seenData.seen) {
            seenCount++;
            console.log(`✓ ${email.message_id} - SEEN at ${seenData.seen_at}`);
          } else {
            notSeenCount++;
            console.log(`○ ${email.message_id} - not seen`);
          }
        } catch (error) {
          errorCount++;
          console.error(`✗ ${email.message_id} - ERROR: ${error.message}`);
        }
      }));
      
      // Delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < emails.length) {
        console.log(`⏳ Waiting ${DELAY_MS}ms before next batch...`);
        await sleep(DELAY_MS);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 BACKFILL COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total processed: ${processed}`);
    console.log(`✓ Seen: ${seenCount} (${(seenCount/processed*100).toFixed(1)}%)`);
    console.log(`○ Not seen: ${notSeenCount} (${(notSeenCount/processed*100).toFixed(1)}%)`);
    console.log(`✗ Errors: ${errorCount}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

main();


