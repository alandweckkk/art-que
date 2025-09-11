"use client"

import Main from '@/screens/main'
import JobManager from '@/components/JobManager'
import HelpTooltip from '@/components/HelpTooltip'
import GlobalSearch from '@/components/GlobalSearch'

export default function Home() {
  return (
    <div className="relative min-h-screen" style={{
      backgroundColor: '#f5f5f5',
      padding: '8px 20px 0 20px'
    }}>
      <div className="min-h-screen bg-white" style={{
        borderRadius: '12px 12px 0 0',
        overflow: 'hidden'
      }}>
        {/* Sticky platform header */}
        <div className="sticky top-0 z-40 border-b border-gray-200" style={{ backgroundColor: '#f5f5f5', borderBottomColor: '#E0E0E0' }}>
          <div className="mx-auto flex items-center justify-between px-4 py-3" style={{ maxWidth: '1700px' }}>
            <HelpTooltip />
            <GlobalSearch onSelect={(result) => {
              if (typeof window !== 'undefined') {
                const w = window as Window & {
                  openRecordByEmail?: (email: string, preferredModelRunId?: string) => void
                }
                if (w.openRecordByEmail) {
                  w.openRecordByEmail(result.email, result.latest_model_run_id)
                }
              }
            }} />
          </div>
        </div>
        <Main />
        <JobManager />
      </div>
    </div>
  )
}