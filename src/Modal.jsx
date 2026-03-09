
import React from 'react'

export default function Modal({ title = '', onClose, children }){
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-[min(92vw,700px)] max-h-[88vh] overflow-auto p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className="px-2 py-1 rounded-lg border" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
