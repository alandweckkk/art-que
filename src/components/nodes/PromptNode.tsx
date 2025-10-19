'use client'

import { Handle, Position } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Image from 'next/image'

interface PromptNodeData {
  globalPrompt: string
  setGlobalPrompt: (value: string) => void
  useGlobalPrompt: boolean
  setUseGlobalPrompt: (value: boolean) => void
  fluxPrompt: string
  setFluxPrompt: (value: string) => void
  geminiPrompt: string
  setGeminiPrompt: (value: string) => void
  openaiPrompt: string
  setOpenaiPrompt: (value: string) => void
  fluxMaxPrompt: string
  setFluxMaxPrompt: (value: string) => void
  additionalImages: string[]
  setAdditionalImages: (images: string[]) => void
}

interface PromptNodeProps {
  data: PromptNodeData
}

export default function PromptNode({ data }: PromptNodeProps) {
  const {
    globalPrompt, setGlobalPrompt, useGlobalPrompt, setUseGlobalPrompt,
    fluxPrompt, setFluxPrompt, geminiPrompt, setGeminiPrompt, openaiPrompt, setOpenaiPrompt,
    fluxMaxPrompt, setFluxMaxPrompt, additionalImages, setAdditionalImages
  } = data

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showCreateTemplate, setShowCreateTemplate] = useState(false)
  const [showCreateNote, setShowCreateNote] = useState(false)
  const [savedTemplates, setSavedTemplates] = useState<unknown[]>([])
  const [loading, setLoading] = useState(false)
  const [isOpenAILoading, setIsOpenAILoading] = useState(false)
  const templatesRef = useRef<HTMLDivElement>(null)
  const createFormRef = useRef<HTMLDivElement>(null)

  // Form state for creating templates and notes
  const [templateForm, setTemplateForm] = useState({
    name: '',
    prompt: '',
    tags: '',
    favorited: '',
    visible: true,
    raw_notes: '',
    urls: ''
  })

  const [noteForm, setNoteForm] = useState({
    name: '',
    prompt: '',
    tags: '',
    favorited: '',
    visible: true,
    raw_notes: '',
    urls: ''
  })

  // Calculate dynamic height based on content
  const calculateHeight = (text: string) => {
    const lines = text.split('\n').length
    const minLines = Math.max(lines + 1, 5) // At least 5 lines, plus 1 extra line
    return `${minLines * 1.5}rem` // Approximate line height
  }

  // Call OpenAI GPT-4 function
  const callOpenAI = async () => {
    setIsOpenAILoading(true)
    try {
      const response = await fetch('/api/gpt-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: "What is the capital of Italy?"
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      
      // Set the response text in the edit prompt
      if (data.text) {
        setGlobalPrompt(data.text)
      } else if (data.response) {
        setGlobalPrompt(data.response)
      } else {
        console.error('Unexpected response format:', data)
        setGlobalPrompt('Error: Unexpected response format from OpenAI')
      }
    } catch (error) {
      console.error('Error calling OpenAI:', error)
      setGlobalPrompt('Error calling OpenAI. Please try again.')
    } finally {
      setIsOpenAILoading(false)
    }
  }

  // Fetch templates from database
  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('y_sticker_templates')
        .select('*')
        .eq('visible', true)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching templates:', error.message || error)
        return
      }

      setSavedTemplates(data || [])
    } catch (error) {
      console.error('Error fetching templates:', error)
    }
  }

  // Save template to database
  const saveTemplate = async (formData: typeof templateForm) => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('y_sticker_templates')
        .insert([{
          name: formData.name,
          prompt: formData.prompt,
          tags: formData.tags ? formData.tags.split(',').map(tag => tag.trim()) : null,
          favorited: formData.favorited ? formData.favorited.split(',').map(fav => fav.trim()) : null,
          visible: true, // Always set to true as requested
          raw_notes: formData.raw_notes || null,
          urls: formData.urls ? formData.urls.split(',').map(url => url.trim()) : null,
          type: 'template'
        }])
        .select()

      if (error) {
        console.error('Error saving template:', error)
        alert('Error saving template: ' + error.message)
        return false
      }

      console.log('Template saved successfully:', data)
      await fetchTemplates() // Refresh the list
      return true
    } catch (error) {
      console.error('Error saving template:', error)
      alert('Error saving template')
      return false
    } finally {
      setLoading(false)
    }
  }

  // Save note to database
  const saveNote = async (formData: typeof noteForm) => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('y_sticker_templates')
        .insert([{
          name: formData.name,
          prompt: formData.prompt,
          tags: formData.tags ? formData.tags.split(',').map(tag => tag.trim()) : null,
          favorited: formData.favorited ? formData.favorited.split(',').map(fav => fav.trim()) : null,
          visible: true, // Always set to true as requested
          raw_notes: formData.raw_notes || null,
          urls: formData.urls ? formData.urls.split(',').map(url => url.trim()) : null,
          type: 'note'
        }])
        .select()

      if (error) {
        console.error('Error saving note:', error)
        alert('Error saving note: ' + error.message)
        return false
      }

      console.log('Note saved successfully:', data)
      await fetchTemplates() // Refresh the list
      return true
    } catch (error) {
      console.error('Error saving note:', error)
      alert('Error saving note')
      return false
    } finally {
      setLoading(false)
    }
  }

  // Handle click outside to close popovers
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (templatesRef.current && !templatesRef.current.contains(event.target as Node) &&
          createFormRef.current && !createFormRef.current.contains(event.target as Node)) {
        setShowTemplates(false)
        setShowCreateTemplate(false)
        setShowCreateNote(false)
      }
    }

    if (showTemplates || showCreateTemplate || showCreateNote) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showTemplates, showCreateTemplate, showCreateNote])

  // Fetch templates when component mounts or when templates popover opens
  useEffect(() => {
    if (showTemplates) {
      fetchTemplates()
    }
  }, [showTemplates])

  return (
    <div className={`rounded-xl shadow-sm border p-3 w-80 transition-all ${
      useGlobalPrompt 
        ? 'bg-white border-gray-200' 
        : 'bg-gray-100 border-gray-300 opacity-75'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-gray-800">Edit Prompt</div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="useGlobalPrompt"
            checked={useGlobalPrompt}
            onChange={(e) => setUseGlobalPrompt(e.target.checked)}
            className="w-3 h-3 text-blue-600 bg-white border-gray-300 rounded focus:ring-blue-500 focus:ring-1"
          />
          <label htmlFor="useGlobalPrompt" className="text-xs text-gray-600 cursor-pointer">
            Use for all tools
          </label>
        </div>
      </div>
      
      <div className="space-y-3">

        <textarea
          ref={textareaRef}
          value={globalPrompt}
          onChange={(e) => setGlobalPrompt(e.target.value)}
          placeholder="Enter prompt for all AI tools..."
          className={`w-full p-3 border rounded-lg text-sm resize-none focus:outline-none transition-all ${
            useGlobalPrompt 
              ? 'border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white' 
              : 'border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed'
          }`}
          style={{ height: calculateHeight(globalPrompt) }}
          disabled={!useGlobalPrompt}
        />
      </div>

      {/* Templates and OpenAI Buttons */}
      <div className="mt-3 flex gap-2">
        {/* Templates Button */}
        <div className="relative" ref={templatesRef}>
          <button
            onClick={() => setShowTemplates(!showTemplates)}
            className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition-colors border border-gray-300"
          >
            Templates
          </button>

          {/* Templates Popover */}
          {showTemplates && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-2 min-w-[200px] z-20">
              <div className="px-3 py-1 text-xs font-medium text-gray-500 border-b border-gray-100 mb-2">
                Quick Templates
              </div>
              
              {/* Placeholder Template Buttons */}
              <button
                onClick={() => {
                  setGlobalPrompt("Make this image more colorful and vibrant")
                  setShowTemplates(false)
                }}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Colorful & Vibrant
              </button>

              <button
                onClick={() => {
                  setGlobalPrompt("Convert this to a minimalist style")
                  setShowTemplates(false)
                }}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Minimalist Style
              </button>

              <button
                onClick={() => {
                  setGlobalPrompt("Add cartoon-style effects and make it fun")
                  setShowTemplates(false)
                }}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cartoon & Fun
              </button>

              <button
                onClick={() => {
                  setGlobalPrompt("Make this look professional and clean")
                  setShowTemplates(false)
                }}
                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Professional & Clean
              </button>

              {/* Saved Templates from Database */}
              {savedTemplates.length > 0 && (
                <>
                  <div className="border-t border-gray-100 mt-2 pt-2">
                    <div className="px-3 py-1 text-xs font-medium text-gray-500 mb-1">
                      Saved Templates
                    </div>
                    {savedTemplates.map((template) => {
                      const typedTemplate = template as { id: string; prompt: string; name: string; urls?: string[]; raw_notes?: string }
                      return (
                        <button
                          key={typedTemplate.id}
                          onClick={() => {
                            const templatePrompt = typedTemplate.prompt || ''
                          
                          // Check if template contains <feedback> variable
                          if (templatePrompt.includes('<feedback>')) {
                            // Replace <feedback> with existing text
                            const newPrompt = templatePrompt.replace('<feedback>', globalPrompt)
                            setGlobalPrompt(newPrompt)
                          } else {
                            // Normal behavior - replace entire text
                            setGlobalPrompt(templatePrompt)
                          }
                          
                          // Add template URLs to additional images if they exist
                          if (typedTemplate.urls && typedTemplate.urls.length > 0) {
                            const newImages = [...additionalImages]
                            typedTemplate.urls.forEach((url: string) => {
                              if (url.trim() && !newImages.includes(url.trim())) {
                                newImages.push(url.trim())
                              }
                            })
                            setAdditionalImages(newImages)
                          }
                          
                          setShowTemplates(false)
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                        title={typedTemplate.raw_notes || typedTemplate.prompt}
                      >
                        {typedTemplate.name || 'Untitled'}
                      </button>
                      )
                    })}
                  </div>
                </>
              )}

              {/* Create Template and Create Note Buttons */}
              <div className="border-t border-gray-100 mt-2 pt-2 space-y-1">
                <button
                  onClick={() => {
                    setShowCreateTemplate(true)
                    setShowTemplates(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  + Create Template
                </button>
                <button
                  onClick={() => {
                    setShowCreateNote(true)
                    setShowTemplates(false)
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-green-600 hover:bg-green-50 transition-colors"
                >
                  + Create Note
                </button>
              </div>
            </div>
          )}
        </div>

        {/* OpenAI Button */}
        <div className="flex">
          <button
            onClick={callOpenAI}
            disabled={isOpenAILoading}
            className="px-2 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-l-md transition-colors border border-gray-300 border-r-0 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            <Image 
              src="/openai.svg" 
              alt="OpenAI" 
              width={14} 
              height={14}
              className={isOpenAILoading ? 'animate-spin' : ''}
            />
          </button>
          <button
            className="px-1 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-r-md transition-colors border border-gray-300 border-l-0 flex items-center"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Create Template Form Popover */}
      {showCreateTemplate && (
        <div 
            ref={createFormRef}
            className="absolute top-0 right-full mr-2 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-80 z-30"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900">Create Template</h3>
              <button
                onClick={() => setShowCreateTemplate(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm({...templateForm, name: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Template name..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Prompt</label>
                <textarea
                  value={templateForm.prompt}
                  onChange={(e) => setTemplateForm({...templateForm, prompt: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                  rows={3}
                  placeholder="Template prompt..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={templateForm.tags}
                  onChange={(e) => setTemplateForm({...templateForm, tags: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="tag1, tag2, tag3..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Favorited (comma-separated)</label>
                <input
                  type="text"
                  value={templateForm.favorited}
                  onChange={(e) => setTemplateForm({...templateForm, favorited: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="user1, user2..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Raw Notes</label>
                <textarea
                  value={templateForm.raw_notes}
                  onChange={(e) => setTemplateForm({...templateForm, raw_notes: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                  rows={2}
                  placeholder="Additional notes..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">URLs (comma-separated)</label>
                <input
                  type="text"
                  value={templateForm.urls}
                  onChange={(e) => setTemplateForm({...templateForm, urls: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="https://example.com, https://another.com..."
                />
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="templateVisible"
                  checked={templateForm.visible}
                  onChange={(e) => setTemplateForm({...templateForm, visible: e.target.checked})}
                  className="w-3 h-3 text-blue-600 bg-white border-gray-300 rounded focus:ring-blue-500 focus:ring-1"
                />
                <label htmlFor="templateVisible" className="ml-2 text-xs text-gray-700">
                  Visible
                </label>
              </div>
              
              <div className="flex gap-2 pt-2">
                <button
                  onClick={async () => {
                    if (!templateForm.name.trim()) {
                      alert('Please enter a template name')
                      return
                    }
                    
                    const success = await saveTemplate(templateForm)
                    if (success) {
                      setShowCreateTemplate(false)
                      setTemplateForm({
                        name: '',
                        prompt: '',
                        tags: '',
                        favorited: '',
                        visible: true,
                        raw_notes: '',
                        urls: ''
                      })
                    }
                  }}
                  disabled={loading}
                  className="flex-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Saving...' : 'Create Template'}
                </button>
                <button
                  onClick={() => setShowCreateTemplate(false)}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Create Note Form Popover */}
      {showCreateNote && (
        <div 
            ref={createFormRef}
            className="absolute top-0 right-full mr-2 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-80 z-30"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900">Create Note</h3>
              <button
                onClick={() => setShowCreateNote(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={noteForm.name}
                  onChange={(e) => setNoteForm({...noteForm, name: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="Note name..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Prompt</label>
                <textarea
                  value={noteForm.prompt}
                  onChange={(e) => setNoteForm({...noteForm, prompt: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 resize-none"
                  rows={3}
                  placeholder="Note prompt..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={noteForm.tags}
                  onChange={(e) => setNoteForm({...noteForm, tags: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="tag1, tag2, tag3..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Favorited (comma-separated)</label>
                <input
                  type="text"
                  value={noteForm.favorited}
                  onChange={(e) => setNoteForm({...noteForm, favorited: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="user1, user2..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Raw Notes</label>
                <textarea
                  value={noteForm.raw_notes}
                  onChange={(e) => setNoteForm({...noteForm, raw_notes: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500 resize-none"
                  rows={2}
                  placeholder="Additional notes..."
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">URLs (comma-separated)</label>
                <input
                  type="text"
                  value={noteForm.urls}
                  onChange={(e) => setNoteForm({...noteForm, urls: e.target.value})}
                  className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="https://example.com, https://another.com..."
                />
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="noteVisible"
                  checked={noteForm.visible}
                  onChange={(e) => setNoteForm({...noteForm, visible: e.target.checked})}
                  className="w-3 h-3 text-green-600 bg-white border-gray-300 rounded focus:ring-green-500 focus:ring-1"
                />
                <label htmlFor="noteVisible" className="ml-2 text-xs text-gray-700">
                  Visible
                </label>
              </div>
              
              <div className="flex gap-2 pt-2">
                <button
                  onClick={async () => {
                    if (!noteForm.name.trim()) {
                      alert('Please enter a note name')
                      return
                    }
                    
                    const success = await saveNote(noteForm)
                    if (success) {
                      setShowCreateNote(false)
                      setNoteForm({
                        name: '',
                        prompt: '',
                        tags: '',
                        favorited: '',
                        visible: true,
                        raw_notes: '',
                        urls: ''
                      })
                    }
                  }}
                  disabled={loading}
                  className="flex-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Saving...' : 'Create Note'}
                </button>
                <button
                  onClick={() => setShowCreateNote(false)}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
