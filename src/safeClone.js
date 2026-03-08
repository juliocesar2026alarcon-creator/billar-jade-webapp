
export function deepClone(obj){
  try {
    if (typeof structuredClone === 'function') return structuredClone(obj)
  } catch {}
  try { return JSON.parse(JSON.stringify(obj)) } catch { return obj }
}
