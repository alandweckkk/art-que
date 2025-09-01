/*
 One-off script: For a sample of 5 recent client-visible rows, take the existing
 preprocessed_output_image_url as input, flatten onto a 1024x1024 white canvas,
 upload to Supabase Storage, and overwrite preprocessed_output_image_url.

 Environment variables required (already used in app):
 - NEXT_PUBLIC_SUPABASE_URL
 - NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
*/

const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Optional LIMIT and SKIP_IDS from environment
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
  const skipIds = process.env.SKIP_IDS
    ? process.env.SKIP_IDS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  // Select rows matching the client selection criteria
  let query = supabase
    .from('model_run')
    .select('id, preprocessed_output_image_url, created_at')
    .eq('reaction', 'negative')
    .not('feedback_addressed', 'is', true)
    .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false });
  if (Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit);
  }
  const { data: initialRows, error: selErr } = await query;
  if (selErr) {
    console.error('Select error:', selErr);
    process.exit(1);
  }
  if (!initialRows || initialRows.length === 0) {
    console.log('No rows found. Nothing to process.');
    return;
  }

  // Filter out any IDs we want to skip
  const rows = skipIds.length
    ? initialRows.filter((r) => !skipIds.includes(r.id))
    : initialRows;

  if (rows.length === 0) {
    console.log('All selected rows were skipped. Nothing to process.');
    return;
  }

  console.log(`Processing ${rows.length} rows...`);

  const concurrency = Math.max(1, Math.min(parseInt(process.env.CONCURRENCY || '10', 10), 24));
  let active = 0;
  let index = 0;
  let processed = 0;

  async function processRow(row) {
    const id = row.id;
    const srcUrl = row.preprocessed_output_image_url;
    if (!srcUrl || typeof srcUrl !== 'string') {
      console.log(`[${id}] Skipping: preprocessed_output_image_url is empty`);
      return;
    }
    try {
      console.log(`[${id}] Downloading: ${srcUrl}`);
      const res = await fetch(srcUrl);
      if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
      const srcBuffer = Buffer.from(await res.arrayBuffer());

      const canvasSize = 1024;
      const metadata = await sharp(srcBuffer).metadata();
      const width = metadata.width || canvasSize;
      const height = metadata.height || canvasSize;
      let resizeOptions = {};
      if (width > canvasSize || height > canvasSize) {
        resizeOptions = { fit: 'inside', width: canvasSize, height: canvasSize, withoutEnlargement: true };
      } else {
        resizeOptions = { fit: 'inside', width, height, withoutEnlargement: true };
      }

      const resized = await sharp(srcBuffer).resize(resizeOptions).png().toBuffer();
      const resizedMeta = await sharp(resized).metadata();
      const newW = resizedMeta.width || Math.min(width, canvasSize);
      const newH = resizedMeta.height || Math.min(height, canvasSize);
      const left = Math.floor((canvasSize - newW) / 2);
      const top = Math.floor((canvasSize - newH) / 2);

      const finalPng = await sharp({
        create: { width: canvasSize, height: canvasSize, channels: 3, background: { r: 255, g: 255, b: 255 } },
      }).composite([{ input: resized, left, top }]).png().toBuffer();

      let targetBucket = 'generated-images';
      let targetKey;
      try {
        const u = new URL(srcUrl);
        const parts = u.pathname.split('/');
        const publicIdx = parts.findIndex((p) => p === 'public');
        if (publicIdx !== -1 && parts.length > publicIdx + 2) {
          targetBucket = parts[publicIdx + 1];
          targetKey = parts.slice(publicIdx + 2).join('/');
        }
      } catch {}
      if (!targetKey) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        targetKey = `white-bg/${id}-${ts}.png`;
      }

      console.log(`[${id}] Uploading to ${targetBucket}/${targetKey}`);
      const { error: uploadErr } = await supabase.storage.from(targetBucket).upload(targetKey, finalPng, { contentType: 'image/png', upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: pub } = supabase.storage.from(targetBucket).getPublicUrl(targetKey);
      const publicUrl = pub?.publicUrl;
      if (!publicUrl) throw new Error('Failed to get public URL');

      const { error: updErr } = await supabase.from('model_run').update({ preprocessed_output_image_url: publicUrl, updated_at: new Date().toISOString() }).eq('id', id);
      if (updErr) throw updErr;

      console.log(`[${id}] Updated preprocessed_output_image_url -> ${publicUrl}`);
    } catch (err) {
      console.error(`[${row.id}] Error:`, err);
    } finally {
      processed++;
      if (processed % 25 === 0) console.log(`Progress: ${processed}/${rows.length}`);
    }
  }

  await new Promise((resolve) => {
    function launchNext() {
      while (active < concurrency && index < rows.length) {
        const row = rows[index++];
        active++;
        processRow(row).finally(() => {
          active--;
          if (processed === rows.length) resolve();
          else launchNext();
        });
      }
      if (active === 0 && index >= rows.length) resolve();
    }
    launchNext();
  });

  console.log('Done');
}

run().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});


