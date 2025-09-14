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
  const [isExpanded, setIsExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setIsExpanded(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearchIconClick = () => {
    setIsExpanded(true)
    setTimeout(() => {
      inputRef.current?.focus()
    }, 100)
  }

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
    <div ref={containerRef} className={`relative transition-all duration-300 ${isExpanded ? 'w-64' : 'w-auto'}`}>
      <div className="flex items-center">
        {!isExpanded ? (
          // Search icon button (collapsed state)
          <button
            onClick={handleSearchIconClick}
            className="inline-flex items-center cursor-pointer transition-all duration-200"
            title="Search"
            style={{
              gap: '6px',
              padding: '6px 14px',
              backgroundColor: '#ffffff',
              border: '1px solid #e0e0e0',
              borderRadius: '12px',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              fontSize: '14px',
              color: '#666666'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#f9f9f9';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#ffffff';
              e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
            }}
          >
            <svg 
              width="16"
              height="16"
              fill="none"
              stroke="#666666"
              viewBox="0 0 24 24"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
            <span>Search</span>
          </button>
        ) : (
          // Expanded search input
          <div className="relative flex-1">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by email..."
              className="w-full focus:outline-none transition-all duration-200"
              style={{
                padding: '6px 14px',
                backgroundColor: '#ffffff',
                border: '1px solid #e0e0e0',
                borderRadius: '12px',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                fontSize: '14px',
                color: '#666666'
              }}
              onFocus={(e) => {
                if (results.length) setIsOpen(true);
                e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
              }}
            />
            {isLoading && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        )}
      </div>
      {isOpen && results.length > 0 && (
        <div className="absolute mt-1 w-full z-50 max-h-64 overflow-auto no-scrollbar" 
             style={{ 
               backgroundColor: '#ffffff',
               border: '1px solid #e0e0e0',
               borderRadius: '12px',
               boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)'
             }}>
          {results.map((r) => (
            <button
              key={`${r.user_id}-${r.latest_model_run_id || 'none'}`}
              onClick={() => {
                setIsOpen(false)
                setQuery('')
                onSelect(r)
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
            >
              <div className="text-gray-900">{r.email}</div>
              <div className="text-xs text-gray-500">
                {r.latest_model_run_id ? `Latest unresolved run: ${r.latest_model_run_id}` : 'No recent unresolved runs'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}





