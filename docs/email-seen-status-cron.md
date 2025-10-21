# Email Seen Status - Automated Updates

## Overview

The email "seen" status in Stats View is now automatically updated every 2 hours via Supabase `pg_cron`. The system tracks when customers open emails sent through Front.

## How It Works

### Data Flow

1. **Email Sent** → Record created in `z_email_history` with `seen = false`
2. **Cron Job** (every 2 hours) → Checks Front API for seen status
3. **Update** → Sets `seen = true` and `seen_at` timestamp when email is opened
4. **Stats View** → Displays current status (green "✓ Seen" or yellow "○ Not seen")

### Database Components

#### Table: `z_email_history`
- `seen` (boolean) - Whether email was opened
- `seen_at` (timestamptz) - When email was first opened
- `message_id` (text) - Front API message ID
- `type` (varchar) - 'fixed_artwork', 'credit', etc.

#### Table: `email_seen_check_queue`
- Tracks pending HTTP requests to Front API
- Links request IDs to email history records

#### Functions

**`update_email_seen_status()`**
- Queries unseen `fixed_artwork` emails from last 48 hours
- Makes async HTTP GET requests to Front API `/messages/{id}/seen`
- Queues requests for processing
- Returns count of queued checks

**`process_email_seen_responses()`**
- Processes completed HTTP requests from `net._http_response`
- Parses Front API response (Unix timestamp in milliseconds)
- Updates `z_email_history` with seen status and timestamp
- Cleans up old queue entries
- Returns: `(processed_count, seen_count, not_seen_count)`

### Cron Schedule

#### Primary Job: `update-email-seen-status`
- **Schedule**: `0 */2 * * *` (every 2 hours at :00 minutes)
- **Command**: 
  ```sql
  SELECT update_email_seen_status();
  SELECT pg_sleep(10);
  SELECT process_email_seen_responses();
  ```
- **Purpose**: Main job that checks and updates email seen status

#### Cleanup Job: `process-email-seen-responses`
- **Schedule**: `*/15 * * * *` (every 15 minutes)
- **Command**: `SELECT process_email_seen_responses();`
- **Purpose**: Processes any pending responses (backup/cleanup)

## Configuration

### Front API Token
- Stored directly in function (for security, consider using Supabase Vault)
- Required scope: message read access
- Current token expires: Check Front dashboard

### Filters
- Only processes emails with `type = 'fixed_artwork'`
- Only checks last 48 hours
- Limit: 50 emails per run

## Manual Operations

### Run Update Manually
```sql
-- Queue checks for recent emails
SELECT * FROM update_email_seen_status();

-- Wait for HTTP requests (pg_net is async)
SELECT pg_sleep(10);

-- Process responses
SELECT * FROM process_email_seen_responses();
```

### Check Status
```sql
-- View recent emails and their seen status
SELECT 
  message_id,
  type,
  seen,
  seen_at,
  created_at
FROM z_email_history
WHERE type = 'fixed_artwork'
ORDER BY created_at DESC
LIMIT 20;
```

### View Cron Jobs
```sql
SELECT 
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname LIKE 'email%'
  OR jobname LIKE '%seen%';
```

### View Pending Queue
```sql
SELECT 
  q.*,
  e.message_id,
  e.type
FROM email_seen_check_queue q
JOIN z_email_history e ON e.id = q.email_history_id
ORDER BY q.created_at DESC;
```

## Troubleshooting

### No Updates Happening
1. Check cron jobs are active:
   ```sql
   SELECT * FROM cron.job WHERE active = true;
   ```

2. Check for errors in recent runs:
   ```sql
   SELECT * FROM cron.job_run_details 
   ORDER BY start_time DESC 
   LIMIT 10;
   ```

3. Run manually to see errors:
   ```sql
   SELECT * FROM update_email_seen_status();
   ```

### Queue Building Up
```sql
-- Check queue size
SELECT COUNT(*) FROM email_seen_check_queue;

-- Clear old entries
DELETE FROM email_seen_check_queue
WHERE created_at < NOW() - INTERVAL '2 hours';
```

### Front API Rate Limits
- Current limit: 50 requests per batch
- Delay between batches: Built into async pg_net
- If rate limited: Reduce batch size in function

## Stats View Integration

The Stats View (`StatsViewOverlay.tsx`) automatically displays the status:

```typescript
// Fetches seen status from database
const { data: emailHistory } = await supabase
  .from('z_email_history')
  .select('id, created_at, subject_line, message, seen, seen_at, ...')
  .eq('source', 'front')
  .eq('type', 'outbound')
  .order('created_at', { ascending: false })
```

### Display
- **Status Column**: Green "✓ Seen" badge or Yellow "○ Not seen"
- **Seen At Column**: Formatted timestamp when email was opened

## Future Enhancements

1. **Webhook Integration**: Replace cron with Front webhooks for real-time updates
2. **Secure Token Storage**: Move API token to Supabase Vault
3. **Manual Refresh Button**: Add to Stats View UI for on-demand updates
4. **Email Types**: Extend to check 'credit' emails and other types
5. **Analytics**: Track open rates, time-to-open metrics

## Migrations

All database changes are tracked in migrations:
- `create_email_seen_status_cron` - Initial setup
- `fix_email_seen_status_functions` - Fixed timestamp parsing
- `fix_update_email_seen_function_v2` - Final working version

## Related Files

- `/src/components/StatsViewOverlay.tsx` - Stats View UI
- `/scripts/backfill-email-seen-status.js` - One-time backfill script (legacy)
- `/src/lib/front.ts` - Front API client
- `/src/app/api/send-front-email/route.ts` - Email sending endpoint

