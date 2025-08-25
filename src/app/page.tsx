"use client"

import Main from '@/screens/main'
import JobManager from '@/components/JobManager'
import HelpTooltip from '@/components/HelpTooltip'
import GlobalSearch from '@/components/GlobalSearch'

export default function Home() {
  return (
    <div className="relative">
      {/* Sticky platform header */}
      <div className="sticky top-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="mx-auto flex items-center justify-between px-4 py-2" style={{ maxWidth: '1700px' }}>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">Art Que</div>
          <GlobalSearch onSelect={(result) => {
            if (typeof window !== 'undefined' && (window as any).openRecordByEmail) {
              (window as any).openRecordByEmail(result.email, result.latest_model_run_id)
            }
          }} />
        </div>
      </div>
      <HelpTooltip />
      <Main />
      <JobManager />
    </div>
  )
}