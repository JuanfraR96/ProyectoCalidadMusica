import * as musicMetadata from 'music-metadata';

export async function analyzeAudioFile(file, onProgress) {
  // 1. Read metadata
  let metadata = null;
  try {
    metadata = await musicMetadata.parseBlob(file);
  } catch (err) {
    console.warn("Could not parse metadata:", err);
  }

  // 2. Decode Audio
  onProgress('Decodificando audio...');
  const arrayBuffer = await file.arrayBuffer();
  
  // Use standard AudioContext for decoding
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // 3. Setup OfflineAudioContext for analysis
  onProgress('Analizando frecuencias...');
  const sampleRate = audioBuffer.sampleRate;
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.length, sampleRate);
  
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  const analyser = offlineCtx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.0; // We want raw data

  source.connect(analyser);
  analyser.connect(offlineCtx.destination);
  source.start(0);

  // We take a snapshot every X seconds to build a spectrogram
  const numSnapshots = 400; // 400 columns in the spectrogram
  const duration = audioBuffer.duration;
  const interval = duration / numSnapshots;
  
  const spectrogramData = [];
  const binCount = analyser.frequencyBinCount;
  
  // Array to accumulate total energy per bin
  const averageSpectrum = new Float32Array(binCount);

  for (let i = 1; i < numSnapshots; i++) {
    const time = i * interval;
    // We must schedule suspend before startRendering
    offlineCtx.suspend(time).then(() => {
      const dataArray = new Uint8Array(binCount);
      analyser.getByteFrequencyData(dataArray);
      
      const copy = new Uint8Array(dataArray);
      spectrogramData.push(copy);
      
      for (let j = 0; j < binCount; j++) {
        averageSpectrum[j] += dataArray[j];
      }
      
      onProgress(`Analizando... ${Math.round((i / numSnapshots) * 100)}%`);
      offlineCtx.resume();
    }).catch(e => {
        // Just in case suspend fails
    });
  }

  await offlineCtx.startRendering();
  
  // Calculate averages
  for (let j = 0; j < binCount; j++) {
    averageSpectrum[j] /= numSnapshots;
  }

  // 4. Heuristic to find cutoff frequency
  // We scan from top (Nyquist) to bottom
  const nyquist = sampleRate / 2;
  const hzPerBin = nyquist / binCount;
  
  let cutoffBin = 0;
  // Threshold: find the bin where average energy goes above a small noise floor
  const threshold = 5; // out of 255
  
  for (let i = binCount - 1; i >= 0; i--) {
    if (averageSpectrum[i] > threshold) {
      cutoffBin = i;
      break;
    }
  }
  
  const cutoffFreq = cutoffBin * hzPerBin;
  
  // Determinar la calidad declarada primero
  let declaredBitrate = "Desconocido";
  let kbps = 0;
  const isLosslessFormat = file.name.toLowerCase().match(/\.(flac|wav|alac|aiff)$/i);

  if (metadata && metadata.format && metadata.format.bitrate) {
    kbps = Math.round(metadata.format.bitrate / 1000);
    declaredBitrate = `${kbps} kbps`;
    if (isLosslessFormat && kbps > 500) {
        declaredBitrate += " (Lossless)";
    }
  } else if (isLosslessFormat) {
    declaredBitrate = "Lossless (FLAC/WAV)";
    kbps = 900; // Valor de referencia aproximado
  }

  // 5. Estimate Real Quality
  let realQuality = "Desconocida";
  let isFake = false;
  
  if (cutoffFreq >= 21500) {
    realQuality = "Lossless / High-Res";
  } else if (cutoffFreq >= 20000) {
    realQuality = "320 kbps";
  } else if (cutoffFreq >= 18500) {
    realQuality = "256 kbps";
  } else if (cutoffFreq >= 17000) {
    realQuality = "192 kbps";
  } else if (cutoffFreq >= 15500) {
    realQuality = "128 kbps";
  } else {
    realQuality = "Menor a 128 kbps";
  }
  
  // Detección de Falsos (Fake / Upscaled)
  if (kbps > 0) {
    // Si dice ser Lossless (FLAC > 500kbps) pero corta antes de 21kHz, es falso
    if (kbps >= 500 && cutoffFreq < 21000) {
      isFake = true;
    } 
    // Si dice ser 320kbps pero corta como un 128/192
    else if (kbps >= 320 && kbps < 500 && cutoffFreq < 19500) {
      isFake = true; 
    }
  } else if (isLosslessFormat) {
    if (cutoffFreq < 21000) {
      isFake = true; 
    }
  }

  return {
    metadata,
    declaredBitrate,
    cutoffFreq,
    realQuality,
    isFake,
    spectrogramData,
    nyquist
  };
}
