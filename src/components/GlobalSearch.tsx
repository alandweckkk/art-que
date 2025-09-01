"use client"

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface SearchResult {
  user_id: string
  email: string
  latest_model_run_id?: string
}

interface GlobalSearchProps {
  onSelect: (result: SearchResult) => void
}

export default function GlobalSearch({ onSelect }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const delay = setTimeout(async () => {
      if (!query || query.length < 2) {
        setResults([])
        return
      }
      setIsLoading(true)
      try {
        // Find users by email ilike
        const { data: users, error: userError } = await supabase
          .from('users_populated')
          .select('id, email')
          .ilike('email', `%${query}%`)
          .limit(10)

        if (userError) {
          console.error('Email search error:', userError)
          setResults([])
          return
        }

        const userIds = (users || []).map(u => u.id)
        const latestByUser: Record<string, string> = {}
        if (userIds.length) {
          // Fetch latest model_run per user within last 3 days matching unresolved with negative reaction
          const { data: runs, error: runError } = await supabase
            .from('model_run')
            .select('id, user_id, created_at')
            .in('user_id', userIds)
            .eq('reaction', 'negative')
            .not('feedback_addressed', 'is', true)
            .gte('created_at', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
            .order('created_at', { ascending: false })

          if (!runError && runs) {
            for (const r of runs as { id: string; user_id: string }[]) {
              const key = String(r.user_id)
              if (!latestByUser[key]) latestByUser[key] = r.id
            }
          }
        }

        const mapped: SearchResult[] = (users || []).map(u => ({
          user_id: String(u.id),
          email: u.email,
          latest_model_run_id: latestByUser[String(u.id)]
        }))
        setResults(mapped)
        setIsOpen(true)
      } finally {
        setIsLoading(false)
      }
    }, 250)
    return () => clearTimeout(delay)
  }, [query])

  return (
    <div ref={containerRef} className="relative w-64">
      <div className="flex items-center">
        <div className="relative flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length && setIsOpen(true)}
            placeholder="Search by email..."
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {isLoading && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </div>
      {isOpen && results.length > 0 && (
        <div className="absolute mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 max-h-64 overflow-auto">
          {results.map((r) => (
            <button
              key={`${r.user_id}-${r.latest_model_run_id || 'none'}`}
              onClick={() => {
                setIsOpen(false)
                setQuery('')
                onSelect(r)
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <div className="text-gray-900 dark:text-gray-100">{r.email}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {r.latest_model_run_id ? `Latest unresolved run: ${r.latest_model_run_id}` : 'No recent unresolved runs'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}





