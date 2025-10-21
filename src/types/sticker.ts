export interface ImageHistoryEntry {
  node_id: string
  image_url: string
  state: 'visible' | 'deleted' | 'sent'
}

export interface StickerEdit {
  sticker_edit_id: string
  model_run_id: string
  status: 'processing' | 'completed' | 'failed' | 'unresolved'
  urgency: string | null
  bucket: 'Urgent' | 'Big Spender' | 'Print Order' | 'Remainder'
  customer_email: string
  customer_name: string
  user_email?: string // Preloaded user email from users_populated
  feedback_notes: string
  input_image_url: string
  output_image_url: string
  preprocessed_output_image_url: string
  initial_edit_image_url: string
  image_history: ImageHistoryEntry[]
  internal_note: string | null
  amount_spent: number
  purchased_at: string
  edit_created_at: string
  edit_updated_at: string
  days_since_created: number
  hours_since_created: number
  minutes_since_created: number
  time_spent_on_edit: number
  image_count: number
  urgency_priority: number
  last_activity_relative: string
  created_at_formatted: string
  purchase_to_edit_delay: number
}
