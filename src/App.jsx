import { useState, useRef, useEffect } from 'react'
import { analyzeAudioFile } from './AudioAnalyzer'
import './index.css'

function App() {
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [result, setResult] = useState(null)
  
  const canvasRef = useRef(null)

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    setIsDragging(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0]
      processFile(file)
    }
  }

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      processFile(file)
    }
  }

  const processFile = async (file) => {
    if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|flac|m4a|ogg)$/i)) {
      alert("Por favor sube un archivo de audio válido.")
      return
    }
    
    setIsProcessing(true)
    setResult(null)
    
    try {
      const res = await analyzeAudioFile(file, setProgressMsg)
      setResult({ ...res, fileName: file.name })
      drawSpectrogram(res.spectrogramData, res.nyquist)
    } catch (err) {
      console.error(err)
      alert("Ocurrió un error al procesar el archivo. Revisa la consola.")
    } finally {
      setIsProcessing(false)
      setProgressMsg('')
    }
  }

  const drawSpectrogram = (data, nyquist) => {
    const canvas = canvasRef.current
    if (!canvas || !data || data.length === 0) return
    
    const ctx = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height
    
    const numCols = data.length
    const numRows = data[0].length // Usually binCount, e.g., 2048
    
    const colWidth = width / numCols
    const rowHeight = height / numRows
    
    // Clear
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)
    
    for (let x = 0; x < numCols; x++) {
      for (let y = 0; y < numRows; y++) {
        const value = data[x][y] // 0 to 255
        if (value > 0) {
          // Heatmap colors: from dark blue to red to yellow
          // Using HSL for simplicity: 240 (blue) to 0 (red) to 60 (yellow)
          // Value 0 => H=240, L=0
          // Value 255 => H=0, L=50... let's use a simpler mapping
          
          const hue = (1 - (value / 255)) * 240
          const lightness = (value / 255) * 60
          
          ctx.fillStyle = `hsl(${hue}, 100%, ${lightness}%)`
          
          // Draw from bottom to top (low frequencies at bottom)
          // Bin 0 is 0Hz, Bin numRows-1 is Nyquist
          ctx.fillRect(x * colWidth, height - (y * rowHeight) - rowHeight, Math.ceil(colWidth), Math.ceil(rowHeight))
        }
      }
    }
    
    // Draw frequency guides
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = '12px Inter'
    ctx.textAlign = 'right'
    const freqsToDraw = [5000, 10000, 15000, 16000, 20000]
    
    freqsToDraw.forEach(freq => {
      if(freq > nyquist) return
      const yRatio = freq / nyquist
      const yPos = height - (yRatio * height)
      
      ctx.beginPath()
      ctx.moveTo(0, yPos)
      ctx.lineTo(width, yPos)
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'
      ctx.stroke()
      
      ctx.fillText(`${freq/1000} kHz`, width - 10, yPos - 5)
    })
  }

  return (
    <div className="app-container">
      <header className="header">
        <h1>TrueAudio Checker</h1>
        <p className="subtitle">Descubre la calidad real de tu música</p>
      </header>
      
      <main className="main-content">
        {!isProcessing && !result && (
          <div 
            className={`dropzone ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById('file-upload').click()}
          >
            <div className="upload-icon">🎵</div>
            <p>Arrastra y suelta un archivo de audio aquí</p>
            <p className="small-text">o haz clic para explorar</p>
            <input 
              id="file-upload" 
              type="file" 
              accept="audio/*" 
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
          </div>
        )}
        
        {isProcessing && (
          <div className="processing-card">
            <div className="spinner"></div>
            <p>{progressMsg}</p>
          </div>
        )}
        
        <div className={`results-container ${result ? 'visible' : ''}`}>
          <div className="canvas-wrapper">
            <canvas ref={canvasRef} width="800" height="400" className="spectrogram"></canvas>
            <div className="canvas-label">Espectrograma</div>
          </div>
          
          {result && (
            <div className="result-details">
              <h2>Resultados para: <span>{result.fileName}</span></h2>
              
              <div className="metrics-grid">
                <div className="metric-box">
                  <span className="metric-label">Calidad Declarada</span>
                  <span className="metric-value">{result.declaredBitrate}</span>
                </div>
                
                <div className="metric-box highlight">
                  <span className="metric-label">Calidad Real Estimada</span>
                  <span className="metric-value">{result.realQuality}</span>
                </div>
                
                <div className="metric-box">
                  <span className="metric-label">Corte de Frecuencia</span>
                  <span className="metric-value">{Math.round(result.cutoffFreq)} Hz</span>
                </div>
              </div>
              
              <div className={`verdict-box ${result.isFake ? 'fake' : 'authentic'}`}>
                {result.isFake ? (
                  <>
                    <div className="verdict-icon">⚠️</div>
                    <div>
                      <strong>¡Cuidado! Archivo escalado (Fake).</strong>
                      <p>Este archivo declara una calidad alta, pero sus frecuencias altas están recortadas, indicando que proviene de una fuente de menor calidad.</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="verdict-icon">✅</div>
                    <div>
                      <strong>Archivo Auténtico</strong>
                      <p>Las frecuencias coinciden con la calidad declarada del archivo.</p>
                    </div>
                  </>
                )}
              </div>
              
              <button className="reset-btn" onClick={() => { setResult(null); document.getElementById('file-upload').value = '' }}>
                Analizar otro archivo
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
