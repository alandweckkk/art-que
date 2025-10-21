# Guide: Adding a New Image Generation Node

This guide walks you through adding a new AI image generation model to the editing platform. We'll use the Seedream v4 implementation as a reference example.

## Overview

The platform uses a modular architecture where each AI model gets:
- A backend API route (handles FAL.ai integration)
- A frontend handler (manages generation flow)
- A reusable UI node component (displays results)
- Database tracking (for generation history)

**Time Required**: ~30 minutes  
**Difficulty**: Intermediate

---

## Step 1: Test the FAL.ai Model API

Before coding, verify the model works and understand its parameters.

### 1.1 Find Your Model on FAL.ai

Visit [fal.ai/models](https://fal.ai/models) and locate your model's documentation.

Key information to gather:
- Model ID (e.g., `fal-ai/bytedance/seedream/v4/edit`)
- Required parameters
- Optional parameters
- Output format
- Expected response structure

### 1.2 Make a Test cURL Call

```bash
# Get your FAL API key
cat .env.local | grep FAL_KEY

# Test the API
curl --request POST \
  --url https://fal.run/fal-ai/YOUR-MODEL-ID \
  --header "Authorization: Key YOUR_FAL_KEY" \
  --header "Content-Type: application/json" \
  --data '{
     "prompt": "Test prompt",
     "image_urls": ["https://example.com/test.png"],
     "num_images": 1
   }'
```

### 1.3 Document the Response

Note the structure of the successful response:
```json
{
  "images": [
    {
      "url": "https://...",
      "content_type": "image/png",
      "file_name": "...",
      "file_size": 825202
    }
  ],
  "seed": 1339938647
}
```

---

## Step 2: Create the Backend API Route

### 2.1 Create the API Directory

```bash
mkdir -p src/app/api/YOUR-MODEL-NAME
```

### 2.2 Copy and Modify the Template

Copy an existing route as a template:

```bash
cp src/app/api/new-fal-gemini-2.5/route.ts \
   src/app/api/YOUR-MODEL-NAME/route.ts
```

### 2.3 Update the Route Code

Edit `src/app/api/YOUR-MODEL-NAME/route.ts`:

#### Change 1: Update Console Logs
```typescript
console.log('🎯 FAL YOUR-MODEL-NAME API called');
console.log('🎯 Model:', 'fal-ai/YOUR-MODEL-ID');
```

#### Change 2: Configure FAL Input
```typescript
const falInput = {
  prompt: prompt,
  image_urls: imageUrls,
  num_images: 1,
  // Add model-specific parameters here
  // Example: enable_safety_checker: false,
};
```

#### Change 3: Update Model ID
```typescript
const result = await fal.subscribe('fal-ai/YOUR-MODEL-ID', {
  input: falInput,
  logs: true,
  onQueueUpdate: (update) => {
    console.log('📊 Queue update:', update.status);
    if ('logs' in update && update.logs) {
      update.logs.forEach((log: { message: string }) => console.log('📝 Log:', log.message));
    }
  }
});
```

#### Change 4: Handle Model-Specific Response Fields
```typescript
const generatedImageUrl = result.data.images[0].url;
// Replace 'description' with your model's metadata field
const metadata = result.data.seed || result.data.description || null;
console.log('🖼️ Generated image URL:', generatedImageUrl);
console.log('📊 Metadata:', metadata);
```

#### Change 5: Update Blob Storage Filename
```typescript
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const filename = `your-model-name-${timestamp}.png`; // or .jpg

const blob = await put(filename, imageBuffer, {
  access: 'public',
  contentType: 'image/png', // Match your model's output
});
```

#### Change 6: Update Database Metadata
```typescript
metadata: {
  originalUrl: generatedImageUrl,
  seed: metadata, // or description, or other model-specific fields
  falResponse: result.data
}
```

---

## Step 3: Add Frontend Handler

Edit `src/components/ReactFlowCanvas.tsx`

### 3.1 Choose a Node ID Pattern

Pick a unique node ID prefix:
- Gemini uses: `g-1`, `g-2`
- Seedream uses: `s-1`
- Your model: `YOUR_PREFIX-1`

### 3.2 Add the Handler Function

Add after the existing handlers (around line 583):

```typescript
const handleYourModelGenerate = async () => {
  if (selectedInputImages.length === 0) {
    alert('Please select at least one image from the Input Images node')
    return
  }

  if (!globalPrompt.trim()) {
    alert('Please enter a prompt')
    return
  }

  try {
    const generationId = await createGeneration('YOUR_PREFIX-1', globalPrompt, selectedInputImages)
    await loadGenerations()
    
    const formData = new FormData()
    formData.append('prompt', globalPrompt)
    formData.append('modelRunId', sticker.model_run_id)
    formData.append('nodeId', 'YOUR_PREFIX-1')
    formData.append('generationId', generationId)
    selectedInputImages.forEach(url => formData.append('imageUrls', url))

    const response = await fetch('/api/YOUR-MODEL-NAME', {
      method: 'POST',
      body: formData
    })

    const result = await response.json()
    
    if (result.success && result.data.imageUrl) {
      await appendToImageHistory(result.data.imageUrl, 'YOUR_PREFIX-1')
      await loadGenerations()
    } else {
      throw new Error(result.error || 'Failed to generate image')
    }
  } catch (error) {
    console.error('Your model generation error:', error)
    alert(error instanceof Error ? error.message : 'Failed to generate image')
    await loadGenerations()
  }
}
```

---

## Step 4: Add Node Positioning

Edit `src/components/ReactFlowCanvas.tsx` in the `nodePositions` useMemo (around line 457):

### 4.1 Add Base Position

```typescript
const basePositions = {
  'prompt-1': { x: 50, y: 250 },
  'images-1': { x: 400, y: 250 },
  'gemini-node': { x: 750, y: 250 },
  'gemini-node-2': { x: 750, y: 520 },
  'seedream-node': { x: 750, y: 790 },
  'your-model-node': { x: 750, y: 1060 },  // ← Add this (270px below previous)
  // ... rest of positions
}
```

### 4.2 Add Dynamic Height

```typescript
const nodeHeights = {
  'prompt-1': 150,
  'internal-1': 150,
  'user-info-1': 200,
  'images-1': 200,
  'gemini-node': getNodeOutput('g-1').imageUrl ? 400 : 150,
  'gemini-node-2': getNodeOutput('g-2').imageUrl ? 400 : 150,
  'seedream-node': getNodeOutput('s-1').imageUrl ? 400 : 150,
  'your-model-node': getNodeOutput('YOUR_PREFIX-1').imageUrl ? 400 : 150, // ← Add this
  'email-composer': 300
}
```

### 4.3 Add Overlap Prevention Logic

```typescript
// Adjust your model position if previous node has image
if (getNodeOutput('s-1').imageUrl) { // Use the previous node's ID
  const previousBottom = adjustedPositions['seedream-node'].y + nodeHeights['seedream-node']
  adjustedPositions['your-model-node'].y = Math.max(
    basePositions['your-model-node'].y,
    previousBottom + 10 // 10px gap
  )
}
```

---

## Step 5: Add the Node to Canvas

Edit `src/components/ReactFlowCanvas.tsx` in the `initialNodes` array (around line 1155):

### 5.1 Add Node Definition

```typescript
{
  id: 'your-model-node',
  type: 'geminiNode', // Reuse the existing component
  position: nodePositions['your-model-node'],
  data: { 
    title: 'Your Model Name',
    tool: 'yourmodel' as const,
    output: getNodeOutput('YOUR_PREFIX-1'),
    onGenerate: handleYourModelGenerate,
    onAttachToEmail: (imageUrl: string) => {
      console.log('Attaching Your Model image:', imageUrl)
      if (!selectedImages.includes(imageUrl)) {
        setSelectedImages(prev => [...prev, imageUrl])
      }
      setAttachedNodes(prev => {
        const newSet = new Set([...prev, 'your-model-node'])
        console.log('Updated attached nodes:', Array.from(newSet))
        return newSet
      })
    },
    onClear: () => hideGeneration('YOUR_PREFIX-1'),
    onAddToInputs: (imageUrl: string) => {
      console.log('Adding Your Model output to input images:', imageUrl)
      if (!additionalImages.includes(imageUrl)) {
        setAdditionalImages(prev => [...prev, imageUrl])
      }
    },
  },
},
```

---

## Step 6: Add Connection Edges

Edit `src/components/ReactFlowCanvas.tsx` in the `initialEdges` useMemo (around line 1359):

### 6.1 Add Prompt Edge

```typescript
const edges: Edge[] = [
  // Prompt to all outputs
  { id: 'prompt-gemini-node', source: 'prompt-1', target: 'gemini-node', animated: true, style: { stroke: '#f97316' } },
  { id: 'prompt-gemini-node-2', source: 'prompt-1', target: 'gemini-node-2', animated: true, style: { stroke: '#f97316' } },
  { id: 'prompt-seedream-node', source: 'prompt-1', target: 'seedream-node', animated: true, style: { stroke: '#e11d48' } },
  { id: 'prompt-your-model-node', source: 'prompt-1', target: 'your-model-node', animated: true, style: { stroke: '#YOUR_COLOR' } }, // ← Add this
]
```

### 6.2 Add Image Input Edge

```typescript
// Add image edges if enabled
if (includeOriginalDesign || includeInputImage) {
  edges.push(
    { id: 'images-gemini-node', source: 'images-1', target: 'gemini-node', animated: true, style: { stroke: '#3b82f6' } },
    { id: 'images-gemini-node-2', source: 'images-1', target: 'gemini-node-2', animated: true, style: { stroke: '#3b82f6' } },
    { id: 'images-seedream-node', source: 'images-1', target: 'seedream-node', animated: true, style: { stroke: '#3b82f6' } },
    { id: 'images-your-model-node', source: 'images-1', target: 'your-model-node', animated: true, style: { stroke: '#3b82f6' } }, // ← Add this
  )
}
```

### 6.3 Add Email Attachment Edge

```typescript
if (attachedNodes.has('your-model-node')) {
  console.log('Adding Your Model → Email edge')
  edges.push({ 
    id: 'your-model-node-email', 
    source: 'your-model-node', 
    target: 'email-composer', 
    animated: true, 
    style: { stroke: '#YOUR_COLOR', strokeWidth: 3, strokeDasharray: '8,4' } 
  })
}
```

---

## Step 7: Update Email Detachment Logic

Edit `src/components/ReactFlowCanvas.tsx` in the email composer node (around line 1340):

```typescript
onDetachImage: (imageUrl: string) => {
  console.log('Detaching image:', imageUrl)
  setSelectedImages(prev => prev.filter(img => img !== imageUrl))
  
  // Find which node this image belongs to and remove it from attached nodes
  const geminiImage = getNodeOutput('g-1').imageUrl
  const gemini2Image = getNodeOutput('g-2').imageUrl
  const seedreamImage = getNodeOutput('s-1').imageUrl
  const yourModelImage = getNodeOutput('YOUR_PREFIX-1').imageUrl // ← Add this
  
  setAttachedNodes(prev => {
    const newSet = new Set(prev)
    if (imageUrl === geminiImage) newSet.delete('gemini-node')
    if (imageUrl === gemini2Image) newSet.delete('gemini-node-2')
    if (imageUrl === seedreamImage) newSet.delete('seedream-node')
    if (imageUrl === yourModelImage) newSet.delete('your-model-node') // ← Add this
    console.log('Updated attached nodes after detach:', Array.from(newSet))
    return newSet
  })
},
```

---

## Step 8: Update TypeScript Types

Edit `src/components/nodes/GeminiNode.tsx`:

```typescript
interface GeminiNodeData {
  title: string
  tool: 'flux' | 'gemini' | 'gemini2' | 'openai' | 'flux_max' | 'seedream' | 'yourmodel' // ← Add your tool
  output?: {
    status: 'idle' | 'processing' | 'completed' | 'failed'
    imageUrl?: string
    prompt?: string
    timestamp?: Date
    inputImages?: string[]
  }
  onGenerate: () => void
  onAttachToEmail?: (imageUrl: string) => void
  onClear?: () => void
  onAddToInputs?: (imageUrl: string) => void
}
```

---

## Step 9: Test the Implementation

### 9.1 Start the Development Server

```bash
pnpm dev
```

### 9.2 Test Checklist

- [ ] Node appears on canvas in correct position
- [ ] Edges connect from Prompt and Input Images
- [ ] Click "Ready to Generate" triggers API call
- [ ] Node shows "Generating..." status
- [ ] Generated image appears in node after ~10 seconds
- [ ] Can attach image to email (edge appears)
- [ ] Can add image to inputs for iterative editing
- [ ] Can clear/hide generation
- [ ] Database records in `y_sticker_edits_generations`
- [ ] Image appears in `image_history`

### 9.3 Check Console Logs

Look for:
```
🎯 FAL YOUR-MODEL-NAME API called
✅ Created generation YOUR_PREFIX-1-...
🚀 Submitting YOUR-MODEL-NAME request...
✅ Fal.AI response received
📤 Uploading to blob storage...
✅ Successfully uploaded to blob storage
✅ Updated generation ... to completed
```

---

## Common Issues & Solutions

### Issue: "No images in Fal.AI response"

**Cause**: Model returned unexpected response structure  
**Solution**: Log the full response and adjust parsing:
```typescript
console.log('📊 COMPLETE API RESPONSE:', JSON.stringify(result, null, 2));
```

### Issue: Node doesn't appear

**Cause**: Position calculation error or missing dependency  
**Solution**: Check `nodePositions` useMemo dependencies include `generations`

### Issue: Prompt text is old/stale

**Cause**: Missing `globalPrompt` in useMemo dependencies  
**Solution**: Already fixed in line 1357 - ensure it's in the array

### Issue: Generation stuck at "processing"

**Cause**: Database update failed or API didn't complete  
**Solution**: Check console logs and Supabase `y_sticker_edits_generations` table

---

## Color Reference

Choose a unique color for your node:

| Color | Hex | Used By |
|-------|-----|---------|
| Orange | `#f97316` | Gemini |
| Red | `#e11d48` | Seedream |
| Purple | `#8b5cf6` | Available |
| Green | `#10b981` | Available |
| Dark Purple | `#6d28d9` | Available |
| Blue | `#3b82f6` | Input images |

---

## Example: Complete Seedream Implementation

See these files for a complete working example:
- Backend: `/src/app/api/seedream-v4-edit/route.ts`
- Frontend: Search `handleSeedreamGenerate` in `/src/components/ReactFlowCanvas.tsx`
- Node ID: `s-1`
- Tool name: `'seedream'`

---

## Summary Checklist

- [ ] Step 1: Tested FAL.ai API via cURL
- [ ] Step 2: Created backend API route
- [ ] Step 3: Added frontend handler function
- [ ] Step 4: Added node positioning logic
- [ ] Step 5: Added node to initialNodes array
- [ ] Step 6: Added connection edges
- [ ] Step 7: Updated email detachment logic
- [ ] Step 8: Updated TypeScript types
- [ ] Step 9: Tested end-to-end functionality

**Estimated Time**: 20-30 minutes for experienced developers

---

## Need Help?

Common debugging steps:
1. Check browser console for errors
2. Check Next.js server logs for API errors
3. Query Supabase tables directly to verify data
4. Use React DevTools to inspect component state
5. Check network tab for API request/response

Good luck! 🚀

