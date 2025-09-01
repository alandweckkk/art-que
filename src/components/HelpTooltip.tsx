'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function HelpTooltip() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const openModal = () => setIsModalOpen(true)
  const closeModal = () => setIsModalOpen(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <>
      {/* Tooltip Button - Positioned in header */}
      <div className="flex items-center">
        <button
          onClick={openModal}
          className="w-8 h-8 bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-md transition-colors duration-200 flex items-center justify-center group"
          title="Help & Information"
        >
          {/* Question mark icon */}
          <svg 
            className="w-5 h-5" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
            />
          </svg>
        </button>
      </div>

      {/* Modal (rendered in a portal to avoid clipping) */}
      {isModalOpen && mounted && createPortal(
        <div className="fixed inset-0 z-[9999] overflow-y-auto">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={closeModal}
          ></div>

          {/* Modal Content */}
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full mx-auto">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Help &amp; Information
                </h3>
                <button
                  onClick={closeModal}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6">
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-900 dark:text-white">
                    Who Appears &amp; In What Order?
                  </h4>
                  
                  <div className="space-y-3">
                    <h5 className="font-medium text-gray-900 dark:text-white">
                      Who Gets Displayed:
                    </h5>
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border-l-4 border-blue-400">
                      <p className="text-gray-700 dark:text-gray-300">
                        Only customers who gave <strong>negative reactions</strong>, whose <strong>feedback has not been addressed yet</strong>, and who provided feedback <strong>within the past 3 days</strong>. This focuses on recent, actionable negative feedback that hasn&apos;t been addressed yet and needs immediate attention.
                      </p>
                      <div className="mt-3 p-2 bg-gray-800 rounded text-xs text-green-400 font-mono">
                        <div>WHERE reaction = &apos;negative&apos;</div>
                        <div>AND feedback_addressed IS NOT TRUE</div>
                        <div>AND created_at &gt;= NOW() - INTERVAL &apos;3 days&apos;</div>
                      </div>
                    </div>

                    <h5 className="font-medium text-gray-900 dark:text-white mt-4">
                      Priority Order (4 Buckets):
                    </h5>
                    
                    <div className="space-y-3">
                      <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border-l-4 border-red-500">
                        <p className="font-semibold text-red-800 dark:text-red-200">🔥 Bucket 1: Urgent Items</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300">Records with urgency levels (1-5). Higher numbers = higher priority. Ties broken by oldest feedback first.</p>
                        <div className="mt-2 p-2 bg-gray-800 rounded text-xs text-green-400 font-mono">
                          <div>WHERE y_sticker_edits.urgency IS NOT NULL</div>
                          <div>ORDER BY urgency DESC, model_run.created_at ASC</div>
                        </div>
                      </div>
                      
                      <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border-l-4 border-green-500">
                        <p className="font-semibold text-green-800 dark:text-green-200">📦 Bucket 2: Print Order Customers</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300">Customers who ordered physical mail items. Sorted by oldest feedback first.</p>
                        <div className="mt-2 p-2 bg-gray-800 rounded text-xs text-green-400 font-mono">
                          <div>WHERE stripe_captured_events.pack_type = &apos;mail_order&apos;</div>
                          <div>ORDER BY model_run.created_at ASC</div>
                        </div>
                      </div>
                      
                      <div className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg border-l-4 border-purple-500">
                        <p className="font-semibold text-purple-800 dark:text-purple-200">💰 Bucket 3: Big Spenders</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300">Customers who spent more than $9 total. Sorted by oldest feedback first.</p>
                        <div className="mt-2 p-2 bg-gray-800 rounded text-xs text-green-400 font-mono">
                          <div>WHERE SUM(stripe_captured_events.amount) &gt; 9</div>
                          <div>AND pack_type != &apos;mail_order&apos;</div>
                          <div>ORDER BY model_run.created_at ASC</div>
                        </div>
                      </div>
                      
                      <div className="bg-gray-50 dark:bg-gray-900/20 p-3 rounded-lg border-l-4 border-gray-400">
                        <p className="font-semibold text-gray-800 dark:text-gray-200">📋 Bucket 4: Everyone Else</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300">All remaining customers. Sorted by oldest feedback first.</p>
                        <div className="mt-2 p-2 bg-gray-800 rounded text-xs text-green-400 font-mono">
                          <div>WHERE SUM(stripe_captured_events.amount) &lt;= 9</div>
                          <div>AND pack_type != &apos;mail_order&apos;</div>
                          <div>ORDER BY model_run.created_at ASC</div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg border-l-4 border-yellow-400 mt-4">
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        <strong>In summary:</strong> This system ensures urgent items are handled first, then prioritizes valuable customers, while making sure older feedback doesn&apos;t get forgotten.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex justify-end p-6 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
