import React, { useEffect, useRef, useState } from 'react';
import './VoiceRecorder.css';

const RecordingState = {
  IDLE: 'idle',
  RECORDING: 'recording',
};

const VoiceRecorder = ({
  onRecordingStart,
  onRecordingReady,
  onError,
  disabled,
}) => {
  const [recordingState, setRecordingState] = useState(RecordingState.IDLE);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevels, setAudioLevels] = useState([0, 0, 0, 0, 0]);
  const [error, setError] = useState(null);
  const [isSupported, setIsSupported] = useState(true);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const launchContextRef = useRef(null);
  const mimeTypeRef = useRef('audio/webm;codecs=opus');

  useEffect(() => {
    const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasMediaRecorder = !!window.MediaRecorder;
    setIsSupported(hasGetUserMedia && hasMediaRecorder);
  }, []);

  useEffect(() => () => cleanup(), []);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startTimer = () => {
    const startTime = Date.now();
    timerIntervalRef.current = setInterval(() => {
      setRecordingTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const startAudioVisualization = (stream) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateAudioLevel = () => {
        analyser.getByteFrequencyData(dataArray);

        const barCount = 5;
        const barWidth = Math.floor(dataArray.length / barCount);
        const levels = [];

        for (let i = 0; i < barCount; i += 1) {
          const start = i * barWidth;
          const end = start + barWidth;
          const slice = dataArray.slice(start, end);
          const average = slice.reduce((a, b) => a + b, 0) / slice.length;
          levels.push(Math.min(average / 128, 1));
        }

        setAudioLevels(levels);
        animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
      };

      updateAudioLevel();
    } catch (err) {
      // Visualization is optional and should never block recording.
    }
  };

  const stopAudioVisualization = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevels([0, 0, 0, 0, 0]);
  };

  const cleanup = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    stopTimer();
    stopAudioVisualization();
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
  };

  const resolveMimeType = () => {
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/ogg;codecs=opus';
    return mimeType;
  };

  const startRecording = async () => {
    try {
      setError(null);
      const launchContext = onRecordingStart ? await onRecordingStart() : null;
      launchContextRef.current = launchContext;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const mimeType = resolveMimeType();
      mimeTypeRef.current = mimeType;
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const usedMimeType = mimeTypeRef.current || mimeType;
        const extension = usedMimeType.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(audioChunksRef.current, { type: usedMimeType });
        const audioFile = new File([blob], `recording.${extension}`, { type: usedMimeType });
        const launchPayload = launchContextRef.current;

        // Return to idle immediately; transcription runs in background queue.
        setRecordingState(RecordingState.IDLE);
        setRecordingTime(0);
        launchContextRef.current = null;

        if (onRecordingReady) {
          Promise.resolve(onRecordingReady(audioFile, launchPayload)).catch((err) => {
            const message = err?.message || 'Failed to queue recording transcription.';
            setError(message);
            if (onError) onError(message);
          });
        }
      };

      mediaRecorder.onerror = (event) => {
        const message = event?.error?.message || 'Recording failed. Please try again.';
        setError(message);
        if (onError) onError(message);
        launchContextRef.current = null;
        cleanup();
        setRecordingState(RecordingState.IDLE);
      };

      mediaRecorder.start();
      setRecordingState(RecordingState.RECORDING);
      startTimer();
      startAudioVisualization(stream);
    } catch (err) {
      let message = 'Failed to start recording.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        message = 'Microphone access denied. Please enable in browser settings.';
      } else if (err.name === 'NotFoundError') {
        message = 'No microphone found. Please connect a microphone.';
      }
      setError(message);
      if (onError) onError(message);
      launchContextRef.current = null;
      cleanup();
      setRecordingState(RecordingState.IDLE);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      stopTimer();
      stopAudioVisualization();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    }
  };

  const handleClick = () => {
    if (disabled) return;
    if (recordingState === RecordingState.IDLE) {
      startRecording();
    } else {
      stopRecording();
    }
  };

  if (!isSupported) return null;

  if (recordingState === RecordingState.IDLE) {
    return (
      <button
        className={`voice-recorder-button ${disabled ? 'disabled' : ''}`}
        onClick={handleClick}
        disabled={disabled}
        aria-label="Start voice recording"
        title="Record voice note"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>
    );
  }

  return (
    <div className="voice-recorder-panel">
      {error && (
        <div className="recording-error">
          <span className="error-icon">⚠️</span>
          <span className="error-message">{error}</span>
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="recording-timer">{formatTime(recordingTime)}</div>

      <div className="audio-bars">
        {audioLevels.map((level, index) => (
          <div
            key={index}
            className="audio-bar"
            style={{ height: `${Math.max(8, level * 32)}px` }}
          />
        ))}
      </div>

      <button className="stop-button" onClick={stopRecording} aria-label="Stop recording" />
    </div>
  );
};

export default VoiceRecorder;
