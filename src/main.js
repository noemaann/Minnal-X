import './style.css';
import { Camera } from './camera.js';
import { HandTracking } from './handTracking.js';
import { GestureAnalyzer, GESTURES } from './gestures.js';
import { EnergyGloveRenderer } from './glove.js';
import { VisualEffects } from './effects.js';
import { SuperpowersManager } from './powers.js';
import { AudioManager } from './audio.js';

// DOM Elements
const videoEl = document.getElementById('webcam');
const canvasEl = document.getElementById('overlay');
const btnStartCamera = document.getElementById('btn-start-camera');
const btnStopCamera = document.getElementById('btn-stop-camera');
const cameraStatusDot = document.getElementById('camera-status-dot');
const txtCameraStatus = document.getElementById('txt-camera-status');
const btnSimCharge = document.getElementById('btn-sim-charge');
const btnSimZap = document.getElementById('btn-sim-zap');
const txtSystemMode = document.getElementById('txt-system-mode');
const systemStatusDot = document.getElementById('system-status-dot');

// Startup Sequence DOM Elements
const startupOverlay = document.getElementById('startup-overlay');
const startupInitStatus = document.getElementById('startup-init-status');
const logCamera = document.getElementById('log-camera');
const logTracking = document.getElementById('log-tracking');
const logGestures = document.getElementById('log-gestures');
const logEnergy = document.getElementById('log-energy');
const startupOnlineBadge = document.getElementById('startup-online-badge');
const startupActionContainer = document.getElementById('startup-action-container');
const btnActivateMinnal = document.getElementById('btn-activate-minnal');

const txtActivePower = document.getElementById('txt-active-power');
const txtGloveStatus = document.getElementById('txt-glove-status');
const txtHandPosition = document.getElementById('txt-hand-position');
const txtGesture = document.getElementById('txt-gesture');
const txtGestureConfidence = document.getElementById('txt-gesture-confidence');
const txtCharge = document.getElementById('txt-charge');
const barCharge = document.getElementById('bar-charge');

const gesturePalmEl = document.getElementById('gesture-palm');
const gestureFistEl = document.getElementById('gesture-fist');
const gesturePointEl = document.getElementById('gesture-point');
const gestureTwoFingerEl = document.getElementById('gesture-twofinger');

// Instantiate Modules
const ctx = canvasEl.getContext('2d');
const camera = new Camera(videoEl);
const handTracking = new HandTracking();
const gestures = new GestureAnalyzer();
const gloveRenderer = new EnergyGloveRenderer(ctx);
const effects = new VisualEffects(ctx);
const powers = new SuperpowersManager();
const audio = new AudioManager();

// Local App State
let isCameraActive = false;
let animationFrameId = null;

// Throttled hand detection parameters (runs MediaPipe at 30 FPS, rendering/VFX at 60 FPS)
let lastDetectTime = 0;
let lastDetectedLandmarks = null;
let lastDetectionSuccessTime = 0;
// Previous detection snapshot — used to compute per-landmark velocity so we can
// extrapolate hand position on render frames that fall between MediaPipe samples
// (detection runs at ~30fps, render loop at ~60fps). Without this the glove holds
// a stale position for up to 33ms then jumps, which reads as lag on fast moves.
let prevDetectedLandmarks = null;
let prevDetectionSuccessTime = 0;
const MAX_EXTRAPOLATION_MS = 60; // clamp how far we predict ahead to avoid overshoot

// DOM Cache to prevent redundant writes and layout thrashing
const domCache = {
  gloveStatus: '',
  gloveStatusColor: '',
  handPosition: '',
  gesture: '',
  gestureConfidence: '',
  activePower: '',
  charge: '',
  chargeWidth: '',
  systemMode: '',
  systemModeColor: '',
  systemStatusDotBg: '',
  systemStatusDotShadow: '',
  barChargeBg: '',
  barChargeShadow: '',
  activeGestureUI: ''
};

function updateDOMText(key, el, val) {
  if (domCache[key] !== val) {
    if (el) el.textContent = val;
    domCache[key] = val;
  }
}

function updateDOMStyle(key, el, prop, val) {
  if (domCache[key] !== val) {
    if (el) el.style[prop] = val;
    domCache[key] = val;
  }
}

// Add floating FPS display dynamically to viewfinder
const fpsEl = document.createElement('div');
fpsEl.style.position = 'absolute';
fpsEl.style.top = '12px';
fpsEl.style.right = '12px';
fpsEl.style.fontFamily = 'var(--font-display), monospace';
fpsEl.style.fontSize = '0.7rem';
fpsEl.style.fontWeight = 'bold';
fpsEl.style.color = '#ffffff';
fpsEl.style.background = '#111111';
fpsEl.style.padding = '4px 8px';
fpsEl.style.borderRadius = '0';
fpsEl.style.border = 'none';
fpsEl.style.zIndex = '5';
fpsEl.style.letterSpacing = '0.08em';
fpsEl.textContent = 'FPS: --';
canvasEl.parentElement.appendChild(fpsEl);

let lastFpsUpdateTime = 0;
let frameCount = 0;

// Shield visual caching
let lastPalmCenter = null;
let lastShieldRadius = 0;

// Initialize overlay canvas dimensions to fit viewport wrapper
function resizeCanvas() {
  const rect = canvasEl.parentElement.getBoundingClientRect();
  canvasEl.width = rect.width;
  canvasEl.height = rect.height;
  console.log(`Canvas resized: ${canvasEl.width}x${canvasEl.height}`);
}

// Initial canvas size setup
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

/**
 * Predicts current hand landmark positions from the last two MediaPipe samples,
 * so the 60fps render loop doesn't have to freeze on a stale detection while
 * waiting for the next ~33ms detection tick. Falls back to the raw sample when
 * there's no prior frame to derive velocity from, or when the gap is too large
 * to extrapolate safely (hand likely re-entered frame, don't guess).
 */
function extrapolateLandmarks(current, previous, currentTime, previousTime, now) {
  if (!previous) return current;

  const sampleDt = currentTime - previousTime;
  if (sampleDt <= 0 || sampleDt > 150) return current;

  const aheadMs = Math.min(now - currentTime, MAX_EXTRAPOLATION_MS);
  if (aheadMs <= 0) return current;

  const t = aheadMs / sampleDt;
  const predicted = new Array(current.length);
  for (let i = 0; i < current.length; i++) {
    const c = current[i];
    const p = previous[i];
    predicted[i] = {
      x: c.x + (c.x - p.x) * t,
      y: c.y + (c.y - p.y) * t,
      z: c.z + (c.z - p.z) * t
    };
  }
  return predicted;
}

// Main Animation Loop (60 FPS rendering)
function loop() {
  // Clear Canvas
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  const now = performance.now();
  
  // Update FPS Counter
  frameCount++;
  if (now - lastFpsUpdateTime >= 500) {
    const elapsed = now - lastFpsUpdateTime;
    const fps = Math.round((frameCount * 1000) / elapsed);
    fpsEl.textContent = `FPS: ${fps}`;
    frameCount = 0;
    lastFpsUpdateTime = now;
  }

  // If camera is active, execute tracking detection
  let handDetected = false;
  let handCentroid = null;
  let activeGesture = GESTURES.UNKNOWN;
  let gestureConfidence = 0;
  let currentLandmarks = null;

  if (isCameraActive) {
    if (videoEl.readyState >= 2) {
      // Throttle heavy MediaPipe vision tasks to 30 FPS to release CPU overhead
      if (now - lastDetectTime >= 33.3) {
        lastDetectTime = now;
        const results = handTracking.detect(videoEl, now);
        if (results && results.landmarks && results.landmarks.length > 0) {
          // Keep the prior sample around so we can derive velocity for extrapolation
          prevDetectedLandmarks = lastDetectedLandmarks;
          prevDetectionSuccessTime = lastDetectionSuccessTime;
          lastDetectedLandmarks = results.landmarks[0];
          lastDetectionSuccessTime = now;
        } else {
          lastDetectedLandmarks = null;
          prevDetectedLandmarks = null;
        }
      }

      // Smooth coordinate rendering carries on at 60 FPS using last cached landmarks
      if (lastDetectedLandmarks && now - lastDetectionSuccessTime < 150) {
        handDetected = true;
        currentLandmarks = extrapolateLandmarks(
          lastDetectedLandmarks,
          prevDetectedLandmarks,
          lastDetectionSuccessTime,
          prevDetectionSuccessTime,
          now
        );
        
        // Calculate approximate hand position (using middle finger MCP joint - index 9)
        const mcp = currentLandmarks[9];
        if (mcp) {
          handCentroid = { x: mcp.x, y: mcp.y };
        }

        // Calculate palm center centroid (average of wrist 0, index MCP 5, middle MCP 9, ring MCP 13, pinky MCP 17)
        const palmIndices = [0, 5, 9, 13, 17];
        let pSumX = 0, pSumY = 0;
        for (const idx of palmIndices) {
          pSumX += currentLandmarks[idx].x;
          pSumY += currentLandmarks[idx].y;
        }
        lastPalmCenter = {
          x: (pSumX / palmIndices.length) * canvasEl.width,
          y: (pSumY / palmIndices.length) * canvasEl.height
        };

        // Compute shield radius proportional to hand size (Wrist to Middle MCP distance)
        const palmSize = Math.hypot(
          currentLandmarks[0].x - currentLandmarks[9].x,
          currentLandmarks[0].y - currentLandmarks[9].y
        );
        lastShieldRadius = palmSize * canvasEl.width * 0.48;

        // Detect gesture and confidence
        const gestureResult = gestures.analyze(currentLandmarks);
        activeGesture = gestureResult.gesture;
        gestureConfidence = gestureResult.confidence;

        // Render advanced virtual AR glove using the gloveRenderer
        gloveRenderer.updateGlove(currentLandmarks, now, powers);
      } else {
        // Hand tracking lost; feed null to temporal smoothing filter and glove renderer (handles fade out)
        const gestureResult = gestures.analyze(null);
        activeGesture = gestureResult.gesture;
        gestureConfidence = gestureResult.confidence;
        gloveRenderer.updateGlove(null, now, powers);
      }
    } else {
      // Stream loading; feed null to temporal smoothing filter and glove renderer
      const gestureResult = gestures.analyze(null);
      activeGesture = gestureResult.gesture;
      gestureConfidence = gestureResult.confidence;
      gloveRenderer.updateGlove(null, now, powers);
    }
  }

  // Trigger initialization pulse beep/zap when activation sequence finishes
  if (isCameraActive && gloveRenderer.pulseTriggered) {
    console.log('MINNAL-X Energy Glove activation pulse triggered.');
    audio.playZap();
  }

  // Trigger feedback event on a clean stable transition
  if (isCameraActive && gestures.gestureJustChanged) {
    console.log(`Transition Event: GESTURE ➔ ${gestures.currentGesture}`);
    // Play brief feedback audio beep
    audio.playCharge(0.12);
  }

  // Update dynamic status indicators in the HUD (using optimized cached writes)
  if (isCameraActive) {
    // Update modular superpower engine
    powers.updateEngine(
      activeGesture,
      gestures.gestureJustChanged,
      now,
      effects,
      audio,
      lastPalmCenter ? { center: lastPalmCenter, radius: lastShieldRadius } : null
    );

    if (powers.systemMode === 'DEPLETED') {
      updateDOMText('gloveStatus', txtGloveStatus, 'POWER DEPLETED');
      updateDOMStyle('gloveStatusColor', txtGloveStatus, 'color', '#ff4757');
      updateDOMText('handPosition', txtHandPosition, 'N/A');
      updateDOMText('gesture', txtGesture, 'UNKNOWN');
      updateDOMText('gestureConfidence', txtGestureConfidence, '0%');
      updateGestureUI(GESTURES.UNKNOWN);
    } else if (handDetected) {
      updateDOMText('gloveStatus', txtGloveStatus, 'HAND DETECTED');
      updateDOMStyle('gloveStatusColor', txtGloveStatus, 'color', '#2ed573');
      if (handCentroid) {
        updateDOMText('handPosition', txtHandPosition, `X: ${handCentroid.x.toFixed(2)} | Y: ${handCentroid.y.toFixed(2)}`);
      } else {
        updateDOMText('handPosition', txtHandPosition, 'N/A');
      }
      
      updateDOMText('gesture', txtGesture, activeGesture);
      updateDOMText('gestureConfidence', txtGestureConfidence, `${gestureConfidence}%`);
      updateGestureUI(activeGesture);
    } else {
      updateDOMText('gloveStatus', txtGloveStatus, 'NO HAND DETECTED');
      updateDOMStyle('gloveStatusColor', txtGloveStatus, 'color', 'var(--neon-red)');
      updateDOMText('handPosition', txtHandPosition, 'N/A');
      
      updateDOMText('gesture', txtGesture, 'UNKNOWN');
      updateDOMText('gestureConfidence', txtGestureConfidence, '0%');
      updateGestureUI(GESTURES.UNKNOWN);
    }
  } else {
    // Sandbox / Simulation continuous tick
    powers.updateEngine(
      txtGesture.textContent,
      false,
      now,
      effects,
      audio,
      lastPalmCenter ? { center: lastPalmCenter, radius: lastShieldRadius } : null
    );

    if (powers.systemMode === 'DEPLETED') {
      updateDOMText('gloveStatus', txtGloveStatus, 'POWER DEPLETED');
      updateDOMStyle('gloveStatusColor', txtGloveStatus, 'color', '#ff4757');
      updateDOMText('handPosition', txtHandPosition, 'N/A');
      updateDOMText('gesture', txtGesture, 'UNKNOWN');
      updateDOMText('gestureConfidence', txtGestureConfidence, '0%');
      updateGestureUI(GESTURES.UNKNOWN);
    } else if (txtGesture.textContent !== 'UNKNOWN') {
      updateDOMText('gloveStatus', txtGloveStatus, 'HAND DETECTED');
      updateDOMStyle('gloveStatusColor', txtGloveStatus, 'color', '#2ed573');
      updateDOMText('handPosition', txtHandPosition, 'Centroid: 320, 245');
    } else {
      updateDOMText('gloveStatus', txtGloveStatus, 'NO HAND DETECTED');
      updateDOMStyle('gloveStatusColor', txtGloveStatus, 'color', 'var(--neon-red)');
      updateDOMText('handPosition', txtHandPosition, 'N/A');
      updateGestureUI(GESTURES.UNKNOWN);
    }
  }

  // Update capacitor meter and HUD system mode
  updateDOMText('activePower', txtActivePower, powers.activePower ? powers.activePower.name : 'None');
  
  const displayCharge = Math.round(powers.chargeLevel * 100);
  updateDOMText('charge', txtCharge, powers.systemMode === 'THUNDER' ? 'OVERCHARGED!' : `${Math.min(100, Math.max(0, displayCharge))}%`);
  updateDOMStyle('chargeWidth', barCharge, 'width', `${Math.min(100, Math.max(0, powers.chargeLevel * 100))}%`);

  if (powers.systemMode === 'THUNDER') {
    updateDOMText('systemMode', txtSystemMode, 'THUNDER MODE');
    updateDOMStyle('systemModeColor', txtSystemMode, 'color', '#f5a623');
    updateDOMStyle('systemStatusDotBg', systemStatusDot, 'backgroundColor', '#111111');
    updateDOMStyle('systemStatusDotShadow', systemStatusDot, 'boxShadow', 'none');
    
    // Golden pulse styling for energy capacitor progress bar
    updateDOMStyle('barChargeBg', barCharge, 'backgroundColor', '#111111');
    updateDOMStyle('barChargeShadow', barCharge, 'boxShadow', 'none');
  } else if (powers.systemMode === 'DEPLETED') {
    updateDOMText('systemMode', txtSystemMode, 'POWER DEPLETED');
    updateDOMStyle('systemModeColor', txtSystemMode, 'color', '#ff4757');
    updateDOMStyle('systemStatusDotBg', systemStatusDot, 'backgroundColor', '#d5001c');
    updateDOMStyle('systemStatusDotShadow', systemStatusDot, 'boxShadow', 'none');
    
    updateDOMStyle('barChargeBg', barCharge, 'backgroundColor', '#d5001c');
    updateDOMStyle('barChargeShadow', barCharge, 'boxShadow', 'none');
  } else {
    updateDOMText('systemMode', txtSystemMode, 'NORMAL MODE');
    updateDOMStyle('systemModeColor', txtSystemMode, 'color', 'var(--text-muted)');
    updateDOMStyle('systemStatusDotBg', systemStatusDot, 'backgroundColor', '#6e6e6e');
    updateDOMStyle('systemStatusDotShadow', systemStatusDot, 'boxShadow', 'none');
    
    updateDOMStyle('barChargeBg', barCharge, 'backgroundColor', '');
    updateDOMStyle('barChargeShadow', barCharge, 'boxShadow', '');
  }

  // Update & Render Particle Sparks & Blasts
  effects.updateAndDraw(now);

  // Apply screen shake dynamically to both video and overlay canvas
  if (effects.shakeOffset && (Math.abs(effects.shakeOffset.x) > 0.05 || Math.abs(effects.shakeOffset.y) > 0.05)) {
    const transformStr = `translate(${effects.shakeOffset.x}px, ${effects.shakeOffset.y}px)`;
    videoEl.style.transform = `scaleX(-1) ${transformStr}`;
    canvasEl.style.transform = `scaleX(-1) ${transformStr}`;
  } else {
    videoEl.style.transform = 'scaleX(-1)';
    canvasEl.style.transform = 'scaleX(-1)'; // Restore baseline scaleX(-1)
  }

  // Render active lightning shield if visible (handles smooth fade out when hand is lost or during sandbox tests)
  if (powers.shieldOpacity > 0 && lastPalmCenter) {
    effects.drawShield(lastPalmCenter, lastShieldRadius, powers.shieldAngle, powers.shieldOpacity);
  }

  animationFrameId = requestAnimationFrame(loop);
}

// Begin animation frame loop
loop();

// Start Camera Feed & Hand Tracker
async function startCamera() {
  btnStartCamera.disabled = true;
  txtCameraStatus.textContent = 'Starting...';
  cameraStatusDot.style.backgroundColor = '#6e6e6e';
  cameraStatusDot.style.boxShadow = 'none';

  try {
    await camera.start();
    videoEl.style.display = 'block';
    
    // Initialize Hand Tracking resolver
    await handTracking.init();
    
    // Update Camera HUD
    btnStartCamera.disabled = true;
    btnStopCamera.disabled = false;
    
    txtCameraStatus.textContent = 'Camera Active';
    cameraStatusDot.style.backgroundColor = '#111111'; // Ready
    cameraStatusDot.style.boxShadow = 'none';
    
    txtGloveStatus.textContent = 'Searching Hand...';
    txtGloveStatus.style.color = 'var(--neon-gold)';
    
    isCameraActive = true;
    audio.init();
  } catch (err) {
    console.error('main.js: Camera activation failed:', err);
    btnStartCamera.disabled = false;
    
    // Map custom friendly error strings returned from camera.js
    let errorMsg = 'Access Failed';
    if (err.message === 'CAMERA_PERMISSION_DENIED') {
      errorMsg = 'Permission Denied';
    } else if (err.message === 'CAMERA_NOT_FOUND') {
      errorMsg = 'No Camera Found';
    } else if (err.message === 'CAMERA_IN_USE_OR_LOCKED') {
      errorMsg = 'Device In Use';
    } else {
      errorMsg = 'Unknown Error';
    }
    
    txtCameraStatus.textContent = errorMsg;
    cameraStatusDot.style.backgroundColor = 'var(--neon-red)';
    cameraStatusDot.style.boxShadow = 'none';
    
    txtGloveStatus.textContent = 'NO HAND DETECTED';
    txtGloveStatus.style.color = 'var(--neon-red)';
    isCameraActive = false;
  }
}

// Stop Camera Feed
function stopCamera() {
  camera.stop();
  videoEl.style.display = 'none';
  
  btnStartCamera.disabled = false;
  btnStopCamera.disabled = true;
  
  txtCameraStatus.textContent = 'Camera Inactive';
  cameraStatusDot.style.backgroundColor = 'var(--neon-red)';
  cameraStatusDot.style.boxShadow = 'none';
  
  txtGloveStatus.textContent = 'NO HAND DETECTED';
  txtGloveStatus.style.color = 'var(--neon-red)';
  gloveRenderer.reset();
  lastPalmCenter = null;
  lastShieldRadius = 0;
  isCameraActive = false;
}

// Update Active Gesture Class UI indicators
function updateGestureUI(activeGesture) {
  if (domCache.activeGestureUI === activeGesture) return;
  domCache.activeGestureUI = activeGesture;

  gesturePalmEl.classList.toggle('active', activeGesture === GESTURES.OPEN_PALM);
  gestureFistEl.classList.toggle('active', activeGesture === GESTURES.FIST);
  gesturePointEl.classList.toggle('active', activeGesture === GESTURES.POINT);
  gestureTwoFingerEl.classList.toggle('active', activeGesture === GESTURES.TWO_FINGER);
}

function simulateCharge() {
  audio.init(); // Setup sound output on click
  
  // Choose a random gesture to simulate (OPEN_PALM, POINT, or TWO_FINGER)
  const gesturesList = [GESTURES.OPEN_PALM, GESTURES.POINT, GESTURES.TWO_FINGER];
  const chosenGesture = gesturesList[Math.floor(Math.random() * gesturesList.length)];
  const simulatedConfidence = Math.floor(Math.random() * 20) + 80; // 80-99%

  // Initialize mock palm coordinates for visual simulations if camera is inactive
  if (!lastPalmCenter) {
    lastPalmCenter = { x: canvasEl.width / 2, y: canvasEl.height / 2 };
    lastShieldRadius = canvasEl.width * 0.16;
  }
  
  const mockContext = { center: lastPalmCenter, radius: lastShieldRadius };

  // Trigger modular engine state
  powers.updateEngine(chosenGesture, true, performance.now(), effects, audio, mockContext);
  
  // For simulation convenience, boost charge directly by a chunk
  if (chosenGesture !== GESTURES.TWO_FINGER) {
    powers.chargeLevel = Math.min(1.0, powers.chargeLevel + 0.35);
    powers.isCharging = true;
  }
  
  // Update HUD
  txtGesture.textContent = chosenGesture;
  txtGestureConfidence.textContent = `${simulatedConfidence}%`;
  updateGestureUI(chosenGesture);
  
  // Play charging hum sound
  audio.playCharge(0.5);

  // Update UI stats
  txtActivePower.textContent = powers.activePower ? powers.activePower.name : 'None';
  txtCharge.textContent = `${Math.round(powers.chargeLevel * 100)}%`;
  barCharge.style.width = `${powers.chargeLevel * 100}%`;
}

// SIMULATION: Trigger Zap
function simulateZap() {
  audio.init();

  // If currently OPEN_PALM, simulate transition OPEN_PALM ➔ FIST to trigger POWER_BLAST!
  if (txtGesture.textContent === 'OPEN_PALM') {
    console.log('[Sandbox Simulation] Simulating transition: OPEN_PALM ➔ FIST (Triggering POWER_BLAST)');
    
    // Update HUD gesture texts
    txtGesture.textContent = 'FIST';
    txtGestureConfidence.textContent = '99%';
    updateGestureUI(GESTURES.FIST);

    // Call updateEngine with FIST transition mapping
    const mockContext = lastPalmCenter 
      ? { center: lastPalmCenter, radius: lastShieldRadius }
      : { center: { x: canvasEl.width / 2, y: canvasEl.height / 2 }, radius: canvasEl.width * 0.16 };
      
    // Manually force prevGesture state in engine to trigger transition check
    powers.prevGesture = 'OPEN_PALM';
    powers.updateEngine(GESTURES.FIST, true, performance.now(), effects, audio, mockContext);

    // Update capacitor meters
    txtActivePower.textContent = powers.activePower ? powers.activePower.name : 'None';
    txtCharge.textContent = `${Math.round(powers.chargeLevel * 100)}%`;
    barCharge.style.width = `${powers.chargeLevel * 100}%`;
    return;
  }
  
  // Draw simulated lightning bolts on the canvas
  const startX = canvasEl.width / 2;
  const startY = canvasEl.height / 2;
  
  // Select color matching the active superpower
  let lightningColor = '#00f2fe';
  if (powers.activePower) {
    if (powers.activePower.name === 'THUNDER_MODE') {
      lightningColor = '#f5a623';
    } else if (powers.activePower.name === 'LIGHTNING_BOLT') {
      lightningColor = '#9b51e0';
    }
  }

  // Draw lightning arcs from center to random screen points
  for (let i = 0; i < 3; i++) {
    const endX = Math.random() * canvasEl.width;
    const endY = Math.random() * canvasEl.height;
    
    effects.drawLightning({ x: startX, y: startY }, { x: endX, y: endY }, lightningColor);
    effects.spawnSparks(endX, endY, lightningColor);
  }

  // Play lightning zap synth
  audio.playZap();
  
  // Transition back to no gesture / normal power state in engine
  powers.updateEngine(GESTURES.UNKNOWN, true, performance.now(), effects, audio);
  powers.chargeLevel = 0.0;
  
  txtGesture.textContent = 'UNKNOWN';
  txtGestureConfidence.textContent = '0%';
  updateGestureUI(GESTURES.UNKNOWN);
  
  // Update state meters
  txtActivePower.textContent = 'None';
  txtCharge.textContent = '0%';
  barCharge.style.width = '0%';
}

// Event Listeners
btnStartCamera.addEventListener('click', startCamera);
btnStopCamera.addEventListener('click', stopCamera);
btnSimCharge.addEventListener('click', simulateCharge);
btnSimZap.addEventListener('click', simulateZap);

// Cinematic Startup Progression Sequence
function runStartupSequence() {
  setTimeout(() => {
    if (logCamera) logCamera.classList.add('visible');
  }, 400);

  setTimeout(() => {
    if (logTracking) logTracking.classList.add('visible');
  }, 800);

  setTimeout(() => {
    if (logGestures) logGestures.classList.add('visible');
  }, 1200);

  setTimeout(() => {
    if (logEnergy) logEnergy.classList.add('visible');
  }, 1600);

  setTimeout(() => {
    if (startupInitStatus) {
      startupInitStatus.innerHTML = '<span style="color: #2ed573;">✓</span> SYSTEM INITIALIZATION COMPLETE';
      startupInitStatus.style.color = '#2ed573';
    }
    if (startupOnlineBadge) startupOnlineBadge.classList.add('visible');
  }, 2000);

  setTimeout(() => {
    if (startupActionContainer) startupActionContainer.classList.add('visible');
  }, 2300);
}

// Start cinematic sequence on page load
runStartupSequence();

// Handle [ ACTIVATE MINNAL MODE ]
if (btnActivateMinnal) {
  btnActivateMinnal.addEventListener('click', async () => {
    console.log('[MINNAL-X] User activated Minnal Mode.');
    audio.init();
    audio.playZap();

    if (startupOverlay) {
      startupOverlay.classList.add('hidden');
    }

    // Requests camera permission, starts camera feed, initializes hand tracking, and starts glove activation sequence
    await startCamera();
  });
}

console.log('MINNAL-X: Core Architecture Loaded successfully with Cinematic Startup Sequence.');
