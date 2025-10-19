'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { StickerEdit } from '@/types/sticker'

interface CanvasItem {
  id: string
  x: number
  y: number
  data: StickerEdit
}

interface InfiniteCanvasProps {
  items: StickerEdit[]
  onItemSelect?: (item: StickerEdit) => void
  onItemEdit?: (item: StickerEdit) => void
}

export default function InfiniteCanvas({ items, onItemSelect, onItemEdit }: InfiniteCanvasProps) {
  const [canvasItems, setCanvasItems] = useState<CanvasItem[]>([])
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, scale: 1 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [velocity, setVelocity] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number | null>(null)

  // Initialize canvas items with smart clustering by bucket
  useEffect(() => {
    const bucketPositions = {
      'Urgent': { baseX: 0, baseY: 0, color: '#ef4444' },
      'Big Spender': { baseX: 800, baseY: 0, color: '#8b5cf6' },
      'Print Order': { baseX: 0, baseY: 600, color: '#06b6d4' },
      'Remainder': { baseX: 800, baseY: 600, color: '#6b7280' }
    }

    const bucketCounts: Record<string, number> = {}
    
    const newItems: CanvasItem[] = items.map((item) => {
      const bucket = item.bucket
      const bucketInfo = bucketPositions[bucket] || bucketPositions['Remainder']
      const count = bucketCounts[bucket] || 0
      bucketCounts[bucket] = count + 1

      // Arrange items in a loose grid within each bucket area
      const itemsPerRow = 4
      const row = Math.floor(count / itemsPerRow)
      const col = count % itemsPerRow
      
      return {
        id: item.sticker_edit_id,
        x: bucketInfo.baseX + col * 280 + Math.random() * 40 - 20,
        y: bucketInfo.baseY + row * 220 + Math.random() * 40 - 20,
        data: item
      }
    })
    
    setCanvasItems(newItems)
  }, [items])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    // Only start canvas dragging if clicking on the canvas background itself
    if (target === canvasRef.current || target.closest('[data-canvas-background]')) {
      e.preventDefault()
      setIsDragging(true)
      setDragStart({ x: e.clientX - viewBox.x, y: e.clientY - viewBox.y })
    }
  }, [viewBox])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && !draggedItem) {
      const newX = e.clientX - dragStart.x
      const newY = e.clientY - dragStart.y
      
      // Calculate velocity for momentum
      setVelocity({
        x: (newX - viewBox.x) * 0.3,
        y: (newY - viewBox.y) * 0.3
      })
      
      setViewBox(prev => ({
        ...prev,
        x: newX,
        y: newY
      }))
    }
  }, [isDragging, dragStart, draggedItem, viewBox.x, viewBox.y])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setDraggedItem(null)
    
    // Start momentum animation
    if (Math.abs(velocity.x) > 1 || Math.abs(velocity.y) > 1) {
      startMomentumAnimation()
    }
  }, [velocity])

  const startMomentumAnimation = useCallback(() => {
    // eslint-disable-next-line prefer-const
    let currentVelocity = { ...velocity }
    const friction = 0.95
    const minVelocity = 0.5

    const animate = () => {
      currentVelocity.x *= friction
      currentVelocity.y *= friction

      if (Math.abs(currentVelocity.x) > minVelocity || Math.abs(currentVelocity.y) > minVelocity) {
        setViewBox(prev => ({
          ...prev,
          x: prev.x + currentVelocity.x,
          y: prev.y + currentVelocity.y
        }))
        animationRef.current = requestAnimationFrame(animate)
      }
    }

    animationRef.current = requestAnimationFrame(animate)
  }, [velocity])

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newScale = Math.max(0.1, Math.min(3, viewBox.scale * delta))
    
    setViewBox(prev => ({
      ...prev,
      scale: newScale
    }))
  }, [viewBox.scale])

  const handleItemDrag = useCallback((itemId: string, deltaX: number, deltaY: number) => {
    setCanvasItems(prev => prev.map(item => 
      item.id === itemId 
        ? { ...item, x: item.x + deltaX / viewBox.scale, y: item.y + deltaY / viewBox.scale }
        : item
    ))
  }, [viewBox.scale])

  return (
    <div 
      ref={canvasRef}
      className="w-full h-full overflow-hidden cursor-grab active:cursor-grabbing"
      style={{ 
        background: 'radial-gradient(circle at 20px 20px, #e5e7eb 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        minHeight: '100vh'
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
    >
      <div
        data-canvas-background="true"
        style={{
          transform: `translate(${viewBox.x}px, ${viewBox.y}px) scale(${viewBox.scale})`,
          transformOrigin: '0 0',
          width: '100%',
          height: '100%',
          position: 'relative'
        }}
      >
        {/* Bucket zones */}
        <BucketZone title="🚨 Urgent" color="#ef4444" x={-50} y={-50} width={700} height={500} />
        <BucketZone title="💰 Big Spender" color="#8b5cf6" x={750} y={-50} width={700} height={500} />
        <BucketZone title="🖨️ Print Order" color="#06b6d4" x={-50} y={550} width={700} height={500} />
        <BucketZone title="📦 Remainder" color="#6b7280" x={750} y={550} width={700} height={500} />
        
        {canvasItems.map((item) => (
          <StickerCard
            key={item.id}
            item={item}
            isSelected={selectedItems.has(item.id)}
            onDrag={handleItemDrag}
            onSelect={() => {
              const newSelected = new Set(selectedItems)
              if (selectedItems.has(item.id)) {
                newSelected.delete(item.id)
              } else {
                newSelected.add(item.id)
              }
              setSelectedItems(newSelected)
              onItemSelect?.(item.data)
            }}
            onEdit={() => onItemEdit?.(item.data)}
          />
        ))}
      </div>

      {/* Floating Toolbar */}
      {selectedItems.size > 0 && (
        <FloatingToolbar
          selectedCount={selectedItems.size}
          onClearSelection={() => setSelectedItems(new Set())}
          onBulkAction={(action) => {
            console.log(`Bulk action: ${action} on ${selectedItems.size} items`)
            // TODO: Implement bulk actions
          }}
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000
          }}
        />
      )}
    </div>
  )
}

interface BucketZoneProps {
  title: string
  color: string
  x: number
  y: number
  width: number
  height: number
}

function BucketZone({ title, color, x, y, width, height }: BucketZoneProps) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: x,
        top: y,
        width,
        height,
        border: `2px dashed ${color}40`,
        borderRadius: '16px',
        backgroundColor: `${color}08`
      }}
    >
      <div 
        className="absolute top-4 left-4 px-3 py-1 rounded-lg text-sm font-medium"
        style={{ 
          backgroundColor: `${color}20`,
          color: color,
          border: `1px solid ${color}40`
        }}
      >
        {title}
      </div>
    </div>
  )
}

interface FloatingToolbarProps {
  selectedCount: number
  onClearSelection: () => void
  onBulkAction: (action: string) => void
  style?: React.CSSProperties
}

function FloatingToolbar({ selectedCount, onClearSelection, onBulkAction, style }: FloatingToolbarProps) {
  return (
    <div 
      className="bg-white rounded-full shadow-lg border border-gray-200 px-6 py-3 flex items-center gap-4"
      style={style}
    >
      <span className="text-sm font-medium text-gray-700">
        {selectedCount} selected
      </span>
      
      <div className="flex items-center gap-2">
        <button
          onClick={() => onBulkAction('edit')}
          className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors"
        >
          ✏️ Edit
        </button>
        
        <button
          onClick={() => onBulkAction('priority')}
          className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 transition-colors"
        >
          ⚡ Priority
        </button>
        
        <button
          onClick={() => onBulkAction('complete')}
          className="px-3 py-1.5 bg-green-500 text-white text-sm rounded-lg hover:bg-green-600 transition-colors"
        >
          ✅ Complete
        </button>
        
        <button
          onClick={onClearSelection}
          className="px-3 py-1.5 bg-gray-500 text-white text-sm rounded-lg hover:bg-gray-600 transition-colors"
        >
          ✕ Clear
        </button>
      </div>
    </div>
  )
}

interface StickerCardProps {
  item: CanvasItem
  isSelected: boolean
  onDrag: (itemId: string, deltaX: number, deltaY: number) => void
  onSelect: () => void
  onEdit: () => void
}

function StickerCard({ item, isSelected, onDrag, onSelect, onEdit }: StickerCardProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const cardRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY })
  }, [])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      const deltaX = e.clientX - dragStart.x
      const deltaY = e.clientY - dragStart.y
      onDrag(item.id, deltaX, deltaY)
      setDragStart({ x: e.clientX, y: e.clientY })
    }
  }, [isDragging, dragStart, item.id, onDrag])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const getBucketColor = (bucket: string) => {
    switch (bucket) {
      case 'Urgent': return '#ef4444'
      case 'Big Spender': return '#8b5cf6'
      case 'Print Order': return '#06b6d4'
      default: return '#6b7280'
    }
  }

  return (
    <div
      ref={cardRef}
      className="absolute cursor-move select-none"
      style={{
        left: item.x,
        top: item.y,
        transform: isDragging ? 'scale(1.05) rotate(2deg)' : 'scale(1) rotate(0deg)',
        transition: isDragging ? 'none' : 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        zIndex: isDragging ? 1000 : 1,
        filter: isDragging ? 'drop-shadow(0 20px 25px rgba(0, 0, 0, 0.15))' : 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))'
      }}
      onMouseDown={handleMouseDown}
      onClick={onSelect}
    >
      <div 
        className={`bg-white rounded-lg shadow-lg border-2 p-4 w-64 hover:shadow-xl transition-all ${
          isSelected ? 'ring-4 ring-blue-300' : ''
        }`}
        style={{ 
          borderColor: isSelected ? '#3b82f6' : getBucketColor(item.data.bucket),
          backgroundColor: isSelected ? '#f0f9ff' : '#ffffff'
        }}
      >
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900 truncate">
              {item.data.customer_name}
            </div>
            <div className="text-xs text-gray-500">
              ID: {item.data.sticker_edit_id.slice(-8)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div 
              className="px-2 py-1 rounded text-xs font-medium text-white"
              style={{ backgroundColor: getBucketColor(item.data.bucket) }}
            >
              {item.data.bucket}
            </div>
            <div className={`px-2 py-0.5 rounded text-xs font-medium ${
              item.data.status === 'completed' ? 'bg-green-100 text-green-800' :
              item.data.status === 'processing' ? 'bg-yellow-100 text-yellow-800' :
              item.data.status === 'failed' ? 'bg-red-100 text-red-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {item.data.status}
            </div>
          </div>
        </div>
        
        <div className="text-xs text-gray-500 mb-2">
          {item.data.customer_email}
        </div>
        
        {item.data.output_image_url && (
          <img 
            src={item.data.output_image_url} 
            alt="Sticker"
            className="w-full h-32 object-cover rounded mb-2"
            draggable={false}
          />
        )}
        
        <div className="text-xs text-gray-600 mb-2 line-clamp-2">
          {item.data.feedback_notes}
        </div>
        
        <div className="flex justify-between items-center text-xs text-gray-500 mb-2">
          <span>${item.data.amount_spent}</span>
          <span>{item.data.last_activity_relative}</span>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex gap-1 mt-2">
          <button 
            className="flex-1 px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
          >
            ✏️ Edit
          </button>
          <button 
            className="flex-1 px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              console.log('Complete sticker:', item.data.sticker_edit_id)
            }}
          >
            ✅ Done
          </button>
          <button 
            className="px-2 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              console.log('View details:', item.data.sticker_edit_id)
            }}
          >
            👁️
          </button>
        </div>
      </div>
    </div>
  )
}
