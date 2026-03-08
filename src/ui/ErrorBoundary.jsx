
import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props){
    super(props)
    this.state = { hasError: false, message: '' }
  }
  static getDerivedStateFromError(error){
    return { hasError: true, message: String(error && error.message || error) }
  }
  componentDidCatch(error, info){
    // puedes enviar a analytics si lo deseas
    console.error('Error atrapado por ErrorBoundary:', error, info)
  }
  handleReset = () => {
    try {
      localStorage.clear()
      sessionStorage.clear()
    } catch {}
    location.reload()
  }
  render(){
    if (this.state.hasError){
      return (
        <div className="min-h-screen grid place-items-center bg-neutral-50 p-6">
          <div className="max-w-lg w-full bg-white border rounded-2xl shadow-sm p-5 text-sm">
            <h1 className="text-lg font-semibold mb-2">Se encontró un problema al cargar la app</h1>
            <p className="text-neutral-600 mb-3">{this.state.message || 'Error desconocido'}</p>
            <div className="space-y-2 text-neutral-600">
              <p>Pruebe con:</p>
              <ul className="list-disc pl-5">
                <li>Cerrar y volver a abrir la página</li>
                <li>Vaciar datos guardados de este sitio</li>
              </ul>
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={this.handleReset} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white">Reiniciar (limpiar datos)</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
