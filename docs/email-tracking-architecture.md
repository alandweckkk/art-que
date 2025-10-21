# Email Tracking Architecture - Metadata-Based System

## Overview

Email tracking now uses a **single-source-of-truth** approach where Front webhooks create all email history records. We use custom metadata to classify and track different types of emails.

## Architecture

### Data Flow

```
1. Send Email via /api/send-front-email
   ↓ (includes metadata: { reason: 'sticker_edit', model_run_id: 'xxx' })
2. Front API receives and sends email
   ↓
3. Front webhook fires to our Edge Function
   ↓
4. Edge Function extracts metadata and creates z_email_history record
   ↓
5. Cron job (every 2 hours) checks seen status
   ↓
6. Stats View displays results
```

### Database Schema

**Table: `z_email_history`**
```sql
- id (uuid, pk)
- type (varchar) - 'outbound', 'inbound', 'out_reply' (from Front)
- reason (varchar) - 'sticker_edit', 'credit_issued', etc. (from metadata)
- message_id (text) - Front message ID
- conversation_id (text) - Front conversation ID
- model_run_id (uuid) - Link to model_run table
- seen (boolean) - Whether email was opened
- seen_at (timestamptz) - When email was first opened
- source (varchar) - 'front'
- user_email (varchar)
- subject_line (text)
- message (text)
- payload (jsonb) - Full Front webhook payload
- created_at (timestamptz)
```

**Key Indexes:**
- `idx_z_email_history_reason` on `reason`
- `idx_z_email_history_type_reason` on `(type, reason)` where `source='front'`

## Metadata System

### Sending Email with Metadata

When sending emails via `/api/send-front-email`, we attach metadata:

```typescript
const metadata = {
  reason: emailMode === 'credit' ? 'credit_issued' : 'sticker_edit',
  model_run_id: ticketNumber
};

const emailData = {
  to: [customerEmail],
  subject: subject,
  body: body,
  body_format: 'html',
  attachments: attachments,
  metadata: metadata  // ← Custom metadata
};
```

### Webhook Extraction

The `front-webhook` Edge Function extracts metadata:

```typescript
function extractReasonFromFrontPayload(payload: any): string | null {
  const metadata = payload?.target?.data?.metadata;
  return metadata?.reason || null;
}

function extractModelRunIdFromFrontPayload(payload: any): string | null {
  const metadata = payload?.target?.data?.metadata;
  return metadata?.model_run_id || null;
}
```

### Reason Values

| Reason | Description | Used For |
|--------|-------------|----------|
| `sticker_edit` | Fixed artwork sent to customer | Stats View tracking |
| `credit_issued` | Credit notification email | Credit notifications |
| `null` | Other emails (replies, etc.) | General tracking |

## Querying Email History

### Stats View Query

```typescript
const { data: emailHistory } = await supabase
  .from('z_email_history')
  .select('*')
  .eq('source', 'front')
  .eq('type', 'outbound')          // Emails we sent
  .eq('reason', 'sticker_edit')    // Specifically artwork fixes
  .order('created_at', { ascending: false })
  .limit(50)
```

### Cron Job Filter

```sql
SELECT id, message_id
FROM z_email_history
WHERE type = 'outbound'
  AND reason = 'sticker_edit'
  AND source = 'front'
  AND message_id IS NOT NULL
  AND created_at > NOW() - INTERVAL '48 hours'
  AND (seen = false OR seen IS NULL)
```

## Components

### 1. Front API Client (`/lib/front.ts`)

Updated to support metadata in both `sendMessage()` and `replyToConversation()`:

```typescript
interface FrontEmailData {
  to: string[];
  subject: string;
  body: string;
  body_format: 'html' | 'text';
  attachments?: PreparedAttachment[];
  metadata?: Record<string, any>;  // ← Added
}
```

### 2. Send Email Route (`/api/send-front-email/route.ts`)

- Prepares metadata with `reason` and `model_run_id`
- Passes metadata to Front API
- **No longer manually inserts** into `z_email_history` (webhook handles it)

### 3. Front Webhook (`front-webhook` Edge Function)

- Receives webhooks from Front for all email events
- Extracts metadata fields (`reason`, `model_run_id`)
- Creates `z_email_history` record with all data
- Runs on Supabase Edge Runtime

### 4. Stats View (`StatsViewOverlay.tsx`)

- Queries `type='outbound' AND reason='sticker_edit'`
- Displays seen status, timestamps, link views
- Shows last 50 sticker edit emails

### 5. Cron Job (`update-email-seen-status` pg_cron)

- Runs every 2 hours at :00 minutes
- Checks Front API for seen status
- Updates `seen` and `seen_at` fields
- Only processes `reason='sticker_edit'` emails from last 48 hours

## Benefits of This Architecture

### ✅ Advantages

1. **No Duplicates** - Single source of truth (webhook)
2. **Automatic** - No manual DB inserts needed
3. **Extensible** - Easy to add new email types via `reason`
4. **Complete Data** - Webhook captures full Front payload
5. **Reliable** - Front guarantees webhook delivery
6. **Flexible** - Can track any custom metadata

### 🔧 Maintenance

- **Add new email type**: Just pass different `reason` in metadata
- **Query new type**: Filter by the new `reason` value
- **No code changes** needed in webhook or tracking system

## Migration Notes

### What Changed

**Before:**
- `/api/send-front-email` manually inserted `type='fixed_artwork'`
- Webhook also inserted `type='outbound'`  
- Result: 2 records per email (duplicates)
- Stats View queried `type='fixed_artwork'`

**After:**
- `/api/send-front-email` only sends email with metadata
- Webhook creates single record with `type='outbound', reason='sticker_edit'`
- Stats View queries `type='outbound' AND reason='sticker_edit'`
- Cron also uses same filters

### Cleanup Performed

1. Added `reason` column to `z_email_history`
2. Updated old `outbound` records to have `reason='sticker_edit'` where applicable
3. Deleted old `type='fixed_artwork'` duplicate records
4. Updated all queries to use new filters

## Testing

### Verify System is Working

1. **Send a test email** via the app
2. **Check Front webhook logs**:
   ```sql
   SELECT * FROM z_email_history 
   WHERE reason = 'sticker_edit' 
   ORDER BY created_at DESC LIMIT 1;
   ```
3. **Verify metadata** is present:
   - `reason = 'sticker_edit'`
   - `model_run_id` should be populated
4. **Check Stats View** shows the email
5. **Run cron manually** to test seen status:
   ```sql
   SELECT * FROM update_email_seen_status();
   SELECT pg_sleep(10);
   SELECT * FROM process_email_seen_responses();
   ```

### Troubleshooting

**Email not showing in Stats View:**
- Check if webhook created record: `SELECT * FROM z_email_history WHERE message_id='msg_xxx'`
- Verify `reason='sticker_edit'` is set
- Check `type='outbound'`

**Seen status not updating:**
- Verify cron job is running: `SELECT * FROM cron.job WHERE jobname='update-email-seen-status'`
- Check last run: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5`
- Manually run: `SELECT * FROM update_email_seen_status()`

**Metadata not in webhook:**
- Check Front API call includes metadata
- Verify Edge Function version (should be v19+)
- Check Edge Function logs

## Future Enhancements

1. **Real-time webhooks** for seen status (instead of cron)
2. **More reasons**: `'manual_reply'`, `'follow_up'`, etc.
3. **Metadata enrichment**: Add campaign IDs, A/B test groups, etc.
4. **Analytics**: Track open rates, response times by reason
5. **Auto-tagging**: Use metadata to auto-tag conversations in Front

## Related Files

- `/src/lib/front.ts` - Front API client
- `/src/app/api/send-front-email/route.ts` - Email sending endpoint
- `/src/components/StatsViewOverlay.tsx` - Stats View UI
- `front-webhook` Edge Function - Webhook handler
- `update_email_seen_status()` - Cron function
- `process_email_seen_responses()` - Response processor

