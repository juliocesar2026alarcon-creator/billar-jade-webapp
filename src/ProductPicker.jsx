
import React, { useMemo, useState } from 'react'

export default function ProductPicker({ inventory = [], onPick }){
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const k = q.trim().toLowerCase()
    const arr = Array.isArray(inventory) ? inventory : []
    return k ? arr.filter(it => (it?.name||'').toLowerCase().includes(k)) : arr
  }, [q, inventory])

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input
          className="border rounded-lg px-3 py-2 w-full"
          placeholder="Buscar producto..."
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <div className="border rounded-xl overflow-hidden">
        <div className="grid grid-cols-12 bg-neutral-50 border-b px-3 py-2 text-xs font-medium">
          <div className="col-span-7">Producto</div>
          <div className="col-span-2 text-right">Precio</div>
          <div className="col-span-1 text-right">Stock</div>
          <div className="col-span-2 text-right"> </div>
        </div>
        <div className="max-h-[50vh] overflow-auto">
          {list.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-neutral-500">Sin resultados</div>
          )}
          {list.map(it => (
            <div key={it.id} className="grid grid-cols-12 items-center px-3 py-2 border-b text-sm">
              <div className="col-span-7 truncate" title={it.name}>{it.name}</div>
              <div className="col-span-2 text-right">Bs {Number(it.price||0).toFixed(2)}</div>
              <div className="col-span-1 text-right">{it.stock}</div>
              <div className="col-span-2 flex justify-end">
                <button
                  disabled={it.stock <= 0}
                  className={`px-2 py-1 rounded-lg border text-sm ${it.stock <= 0 ? 'opacity-60 cursor-not-allowed' : 'bg-emerald-600 text-white border-emerald-600'}`}
                  onClick={() => onPick && onPick(it)}
                >Agregar</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
